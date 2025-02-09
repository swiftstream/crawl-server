/*
 * MIT License
 * 
 * Copyright (c) 2024 Mikhail Isaev
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
 * Author: Mikhail Isaev
 */

import * as fs from 'fs'
import path from 'path'
import Fastify from 'fastify'
import { fileURLToPath } from 'url'
import { fork } from 'child_process'
import { createHash } from 'crypto'

// This server is created to render WebAssembly-generated web pages.
// Since the WebAssembly app uses global variables extensively, we need to isolate its instances.
// To achieve WebAssembly instance isolation, this server uses child processes via fork.
// When a WebAssembly instance is killed, the child process is also terminated, so a new child process must be instantiated if the WebAssembly code has changed.
// This server also manages `expiresIn` and `lastModifiedAt` values passed from the Swift code, as well as the `ETag` header.
// As a result, it can efficiently serve a high volume of requests from search engine crawlers due to caching.
// Cold start of a new process with a WebAssembly instance takes about 300ms to respond.
// A warm call to a WebAssembly instance takes about 100ms to respond.
// A cached response takes about 1ms.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function start(pathToWasm, port, logger, numberOfChildProcesses, bindGlobally, stateHandler) {
    if (pathToWasm === undefined) {
        if (logger) logger.error('SERVER: Path to WASM is undefined.')
        return { errorCode: 0 }
    }
    if (logger) logger.log(`SERVER: Path to wasm: ${pathToWasm}`)
    if (!fs.existsSync(pathToWasm)) {
        if (logger) logger.log(`SERVER: Unable to start. Wasm file not found at ${pathToWasm}`)
        return { errorCode: 1 }
    }

    const server = new Server({
        pathToWasm: pathToWasm,
        port: port,
        logger: logger,
        numberOfChildProcesses: numberOfChildProcesses,
        bindGlobally: bindGlobally,
        stateHandler: stateHandler
    })
    
    // Define the wildcard route
    server.fastify.get('/*', server.requestHandler)

    // Start the server
    const start = async () => {
        try {
            var options = { port: port }
            if (bindGlobally)
                options.host = '0.0.0.0'
            await server.fastify.listen(options)
            const text = `Server listening on http://localhost:${options.port}`
            server.fastify.log.info(text)
            if (stateHandler) server.updateState({
                state: 'operating',
                situation: 'server_started',
                description: text
            })
            return true
        } catch (err) {
            server.fastify.log.error(err)
            return false
        }
    }
    // Call async start
    if (await start()) {
        return {
            stop: (handler) => {
                server.fastify.close(handler)
                for (let i = 0; i < server.childProcessPool.length; i++) {
                    const child = server.childProcessPool[i]
                    child.kill('SIGTERM')
                }
                if (stateHandler) server.updateState({
                    state: 'stopped',
                    situation: 'fulfilled_stop_call',
                    description: 'Gracefully stopped.'
                })
            }
        }
    } else {
        return { errorCode: 2 }
    }
}

export class Server {
    MAX_CHILD_PROCESSES = 4
    MAX_PENDING_REQUESTS = 1000
    DISASTER_RESPAWN_TIMEOUT = 10 // in seconds

    // Dictionary to store cached HTML strings
    cache = {}
    // Array of child processes
    childProcessPool = []
    // Queue for requests waiting for an available child
    pendingRequests = []
    // Server state
    state = undefined
    // State Handler
    stateHandler = undefined
    // Logger
    logger = undefined
    // Fastify
    fastify = undefined

    constructor (options) {
        this.pathToWasm = options.pathToWasm
        this.port = options.port
        this.bindGlobally = options.bindGlobally
        this.stateHandler = options.stateHandler
        this.numberOfChildProcesses = options.numberOfChildProcesses ?? 1
        this.logger = options.logger
        this.fastify = options.fastify ?? Fastify({ logger: this.logger != undefined })
        
        // Initialize child process pool
        for (let i = 0; i < this.numberOfChildProcesses; i++) {
            const child = this.createChildProcess()
            this.childProcessPool.push(child)
        }
    }

    // Proxy method to `stateHandler` which updates `state` variable
    updateState(s) {
        if (s.state == this.state) return
        this.state = s.state
        this.stateHandler(s)
    }

    // Function to create a new child process and add it to the pool
    createChildProcess() {
        const child = fork(path.join(__dirname, 'process.js'))
        child.busy = false
        child.spawnedAt = (new Date()).getMilliseconds()
        // Handle the exit event to replace dead processes
        child.on('exit', (code, signal) => {
            if (this.logger) this.logger.log(`SERVER: Child process exited with code ${code} and signal ${signal}`)
            // Remove the dead child from the pool
            const index = this.childProcessPool.indexOf(child)
            if (index > -1) {
                this.childProcessPool.splice(index, 1)
            }
            if (signal === 'SIGTERM') {
                const text = 'Stopped child process.'
                if (this.logger) this.logger.log(`SERVER: ${text}`)
                if (this.stateHandler) this.updateState({
                    state: 'stopping',
                    situation: 'stopped_child_process',
                    description: text
                })
                return
            }
            if (!child.intentionally) {
                const disasterCrash = ((new Date()).getMilliseconds() - child.spawnedAt < 5000)
                const respawnTimeout = disasterCrash ? DISASTER_RESPAWN_TIMEOUT * 1000 : 1
                if (disasterCrash) {
                    const text = `Something went wrong with the wasm instance because it crashed too early. Respawning in ${DISASTER_RESPAWN_TIMEOUT}s.`
                    if (this.stateHandler) this.updateState({
                        state: 'failing',
                        situation: 'disasterly_crashed',
                        description: text
                    })
                    if (this.logger) this.logger.error(`SERVER: ${text}`)
                }
                setTimeout(() => {
                    // Create a new child process to replace it
                    if (this.logger) this.logger.log(`SERVER: Creating a new child process to replace it.`)
                    try {
                        const newChild = this.createChildProcess()
                        const text = 'Replaced dead child process with a new one.'
                        if (this.logger) this.logger.log(`SERVER: ${text}`)
                        this.childProcessPool.push(newChild)
                        if (this.stateHandler) this.updateState({
                            state: 'operating',
                            situation: 'respawned_after_disaster',
                            description: text
                        })
                    } catch (error) {
                        if (this.logger && this.logger.error) this.logger.error(`createChildProcess error: ${error}`)
                        else if (this.logger && this.logger.log) this.logger.log(`createChildProcess error: ${error}`)
                    }
                }, respawnTimeout)
            } else {
                if (this.logger) this.logger.log(`SERVER: Child process has been killed intentionally.`)
            }
        })
        return child
    }

    // Kills child process
    // used to kill process with obsolete wasi instance
    killChildProcess(child) {
        setTimeout(() => {
            if (child && child.exitCode === null) { // Check if the child is alive
                if (this.logger) this.logger.log(`SERVER: Killing child process with PID ${child.pid}`)
                child.intentionally = true
                child.kill() // Send the default SIGTERM signal
            }
        }, 1)
    }

    // Find an available child process or await until one becomes free
    getAvailableChildProcess() {
        return new Promise((resolve, reject) => {
            const availableChild = this.childProcessPool.find(child => !child.busy)
            if (availableChild) {
                availableChild.busy = true
                resolve(availableChild)
            } else {
                if (this.pendingRequests.length >= MAX_PENDING_REQUESTS) {
                    reject('Too many requests in the queue.') // Protecting itself from leaking.
                } else {
                    this.pendingRequests.push(resolve) // Queue the request if all children are busy
                }
            }
        })
    }

    // When a child process finishes, mark it as free and check for queued requests
    releaseChildProcess(child) {
        child.busy = false
        if (this.pendingRequests.length > 0) {
            const nextRequest = this.pendingRequests.shift()
            nextRequest(child) // Assign the next request to this child
            child.busy = true
        }
    }

    // Cleanups HTML content from ids
    removeIds(html) {
        return html.replace(/\s+id=["'][^"']*["']/g, '')
    }

    // Generates Etag based on HTML content
    generateETag(content) {
        return createHash('md5').update(content).digest('hex')
    }

    async requestHandler(request, reply) {
        try {
            // Skip resource requests
            // should never go here in production
            if (['ico', 'css', 'js', 'html', 'json'].includes(request.url.split('.').pop())) {
                if (this.logger) this.logger.log(`SERVER: Skipping ${request.url} request`)
                // should be handled by nginx
                return reply.code(404).send()
            }

            const clientETag = request.headers['if-none-match']
            let clientLastModifiedSince = undefined
            // Wrap if-modified-since into try/catch to prevent server crash
            try {
                clientLastModifiedSince = request.headers['if-modified-since'] ? new Date(request.headers['if-modified-since']) : undefined
            } catch {
                clientLastModifiedSince = undefined
            }
            // Prepare path and search
            const urlSplit = request.url.split('?')
            const path = urlSplit[0]
            const search = urlSplit.length > 1 ? urlSplit[1] : ''
            
            // Check if cached content is available and not expired
            const cached = this.cache[request.url]
            const now = Date.now()
            // Check if expiresAt present and not expired
            if (cached && cached.expiresAt && cached.expiresAt > now) {
                // Check if Etag matches the cached one
                if (clientETag && clientETag == cached.etag) {
                    return reply.code(304).send()
                }
                // Return cached content
                else {
                    reply.header('ETag', cached.etag)
                    if (cached.lastModifiedAt) {
                        reply.header('Last-Modified', cached.lastModifiedAt.toUTCString())
                    }
                    return reply.type('text/html').send(cached.html)
                }
            }
            // Check if wasm file present
            if (!fs.existsSync(this.pathToWasm)) {
                if (this.stateHandler) this.updateState({
                    state: 'failing',
                    situation: 'wasm_missing',
                    description: 'WASM file not found unexpectedly'
                })
                return reply.code(500).send()
            }
            const wasmMtime = fs.statSync(this.pathToWasm).mtime.getTime()
            // Cached content is missing or expired
            // so let's get a child process to retrieve the content
            const child = await this.getAvailableChildProcess()
            // Method to work with child process
            async function workWithChild(child, context) {
                // Request the child to generate HTML for this route path
                return new Promise((resolve) => {
                    // Listening for event from the child process
                    child.once('message', async (event) => {
                        // Switching event type
                        switch (event.type) {
                            // Crash
                            case 'crash':
                                if (context.logger) context.logger.log(`PROCESS: Crashed. ${event}`)
                                break
                            // Kill the process with old instance and start fresh one
                            case 'restart':
                                if (context.logger) context.logger.log('SERVER: Got restart event')
                                var starTime = context.logger ? (new Date()).getMilliseconds() : undefined
                                // Kill child with previous wasm instance
                                context.killChildProcess(child)
                                if (context.logger) context.logger.log(`SERVER: Killed child process in ${(new Date()).getMilliseconds() - starTime}ms`)
                                // Create a new child process and add it to the pool
                                if (context.logger) context.logger.log(`SERVER: Creating new child process`)
                                try {
                                    const newChild = context.createChildProcess()
                                    if (context.logger) context.logger.log(`SERVER: Created new child process in ${(new Date()).getMilliseconds() - starTime}ms`)
                                    newChild.busy = true
                                    context.childProcessPool.push(newChild)
                                    if (context.logger) context.logger.log('SERVER: Replaced killed child process with a new one.')
                                    resolve(await workWithChild(newChild))
                                } catch (error) {
                                    reject(error)
                                }
                                break
                            // Unable to render
                            case 'not-rendered':
                                if (context.stateHandler) context.updateState({
                                    state: 'failing',
                                    situation: 'html_not_rendered',
                                    description: `HTML wasn't rendered`
                                })
                                resolve(reply.code(501).send())
                                break
                            // Rendered the page
                            case 'render':
                                if (context.logger) context.logger.log('SERVER: Render called')
                                if (event.html) {
                                    if (context.stateHandler) context.updateState({
                                        state: 'operating',
                                        situation: 'html_rendered',
                                        description: 'HTML rendered successfully'
                                    })
                                    // Retrieve expiresIn and convert it into milliseconds
                                    const expirationTime = (event.expiresIn === 0 ? 60 * 60 * 24 * 30 : event.expiresIn) * 1000
                                    // Retrieve lastModifiedAt and instantiate it as Date
                                    const lastModifiedAt = event.lastModifiedAt ? new Date(event.lastModifiedAt * 1000) : undefined
                                    // Cleanup HTML content from ids since they are randomly generated every time
                                    const html = context.removeIds(event.html)
                                    // Generate Etag based on the clean content
                                    const newEtag = context.generateETag(html)
                                    // Cache the generated HTML with an expiration time
                                    context.cache[request.url] = {
                                        expiresAt: now + expirationTime,
                                        html: html,
                                        etag: newEtag,
                                        lastModifiedAt: lastModifiedAt
                                    }
                                    // Release the child process for the next request
                                    context.releaseChildProcess(child)
                                    // Don't send content if etag is same
                                    if (clientETag && clientETag == newEtag) {
                                        if (context.logger) context.logger.log('SERVER: Etag is same, return 304')
                                        return resolve(reply.code(304).send())
                                    }
                                    // Don't send content if content haven't been modified yet
                                    if (clientLastModifiedSince && clientLastModifiedSince >= cached.lastModifiedAt) {
                                        if (context.logger) context.logger.log('SERVER: LastModifiedAt is same, return 304')
                                        return reply.code(304).send()
                                    }
                                    // Attach Etag header
                                    reply.header('ETag', newEtag)
                                    // Attach Last-Modified header if value is present
                                    if (lastModifiedAt) {
                                        reply.header('Last-Modified', lastModifiedAt.toUTCString())
                                    }
                                    if (context.logger) context.logger.log('SERVER: Return newly rendered html')
                                    // Send the response
                                    resolve(reply.type('text/html').send(html))
                                }
                                // HTML is not present, it is serious server-side error
                                else {
                                    if (context.stateHandler) context.updateState({
                                        state: 'failing',
                                        situation: 'html_not_rendered',
                                        description: `HTML wasn't rendered`
                                    })
                                    resolve(reply.code(500).send())
                                }
                                break
                            default: break
                        }
                    })
                    // Check if wasm file was modified
                    // which will proceed to `render` action
                    child.send({
                        type: 'render',
                        debugLogs: context.logger ? true : undefined,
                        path: path,
                        search: search,
                        serverPort: context.port,
                        pathToWasm: context.pathToWasm,
                        wasmMtime: wasmMtime
                    })
                })
            }
            // Call the child process
            await workWithChild(child, this)
        } catch (error) {
            if (this.stateHandler) this.updateState({
                state: 'failing',
                situation: 'request_failed',
                description: `${error}`
            })
            return reply.code(503).send(this.logger ? `${error}` : undefined) // Service Unavailable
        }
    }
}