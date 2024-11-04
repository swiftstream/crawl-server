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
export function start(pathToWasm, port, debugLogs, numberOfChildProcesses) {
    if (debugLogs) console.log(`SERVER: Path to wasm: ${pathToWasm}`)
    const fastify = Fastify({ logger: debugLogs })

    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)

    const MAX_CHILD_PROCESSES = numberOfChildProcesses ?? 4

    // Dictionary to store cached HTML strings
    const cache = {}
    // Array of child processes
    const childProcessPool = []
    // Queue for requests waiting for an available child
    const pendingRequests = []

    // Function to create a new child process and add it to the pool
    function createChildProcess() {
        const child = fork(path.join(__dirname, 'process.js'))
        child.busy = false
        // Handle the exit event to replace dead processes
        child.on('exit', (code, signal) => {
            if (debugLogs) console.log(`SERVER: Child process exited with code ${code} and signal ${signal}`)
            // Remove the dead child from the pool
            const index = childProcessPool.indexOf(child)
            if (index > -1) {
                childProcessPool.splice(index, 1)
            }
            if (!child.intentionally) {
                // Create a new child process to replace it
                const newChild = createChildProcess()
                if (debugLogs) console.log(`SERVER: Replaced dead child process with a new one.`)
                childProcessPool.push(newChild)
            } else {
                if (debugLogs) console.log(`SERVER: Child process has been killed intentionally.`)
            }
        })
        return child
    }

    // Kills child process
    // used to kill process with obsolete wasi instance
    function killChildProcess(child) {
        setTimeout(() => {
            if (child && child.exitCode === null) { // Check if the child is alive
                if (debugLogs) console.log(`SERVER: Killing child process with PID ${child.pid}`)
                child.intentionally = true
                child.kill() // Send the default SIGTERM signal
            }
        }, 1)
    }

    // Initialize child process pool
    for (let i = 0; i < MAX_CHILD_PROCESSES; i++) {
        const child = createChildProcess()
        childProcessPool.push(child)
    }

    // Find an available child process or await until one becomes free
    function getAvailableChildProcess() {
        return new Promise((resolve) => {
            const availableChild = childProcessPool.find(child => !child.busy)
            if (availableChild) {
                availableChild.busy = true
                resolve(availableChild)
            } else {
                pendingRequests.push(resolve) // Queue the request if all children are busy
            }
        })
    }

    // When a child process finishes, mark it as free and check for queued requests
    function releaseChildProcess(child) {
        child.busy = false
        if (pendingRequests.length > 0) {
            const nextRequest = pendingRequests.shift()
            nextRequest(child) // Assign the next request to this child
            child.busy = true
        }
    }

    // Cleanups HTML content from ids
    function removeIds(html) {
        return html.replace(/\s+id=["'][^"']*["']/g, '')
    }

    // Generates Etag based on HTML content
    function generateETag(content) {
        return createHash('md5').update(content).digest('hex')
    }

    // Define the wildcard route
    fastify.get('/*', async (request, reply) => {
        // Skip resource requests
        // should never go here in production
        if (['ico', 'css', 'js', 'html', 'json'].includes(request.url.split('.').pop())) {
            if (debugLogs) console.log(`SERVER: Skipping ${request.url} request`)
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
        const cached = cache[request.url]
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
        if (!fs.existsSync(pathToWasm)) {
            return reply.code(500).send()
        }
        const wasmMtime = fs.statSync(pathToWasm).mtime.getTime()
        // Cached content is missing or expired
        // so let's get a child process to retrieve the content
        const child = await getAvailableChildProcess()
        // Method to work with child process
        async function workWithChild(child) {
            // Request the child to generate HTML for this route path
            return new Promise((resolve) => {
                // Listening for event from the child process
                child.once('message', async (event) => {
                    // Switching event type
                    switch (event.type) {
                        // Kill the process with old instance and start fresh one
                        case 'restart':
                            if (debugLogs) console.log('SERVER: Got restart event')
                            var starTime = debugLogs ? (new Date()).getMilliseconds() : undefined
                            child.mike = "hero"
                            // Kill child with previous wasm instance
                            killChildProcess(child)
                            if (debugLogs) console.log(`SERVER: Killed child process in ${(new Date()).getMilliseconds() - starTime}ms`)
                            // Create a new child process and add it to the pool
                            const newChild = createChildProcess()
                            if (debugLogs) console.log(`SERVER: Created new child process in ${(new Date()).getMilliseconds() - starTime}ms`)
                            newChild.busy = true
                            childProcessPool.push(newChild)
                            if (debugLogs) console.log('SERVER: Replaced killed child process with a new one.')
                            resolve(await workWithChild(newChild))
                            break
                        // Rendered the page
                        case 'render':
                            if (debugLogs) console.log('SERVER: Render called')
                            if (event.html) {
                                // Retrieve expiresIn and convert it into milliseconds
                                const expirationTime = (event.expiresIn === 0 ? 60 * 60 * 24 * 30 : event.expiresIn) * 1000
                                // Retrieve lastModifiedAt and instantiate it as Date
                                const lastModifiedAt = event.lastModifiedAt ? new Date(event.lastModifiedAt * 1000) : undefined
                                // Cleanup HTML content from ids since they are randomly generated every time
                                const html = removeIds(event.html)
                                // Generate Etag based on the clean content
                                const newEtag = generateETag(html)
                                // Cache the generated HTML with an expiration time
                                cache[request.url] = {
                                    expiresAt: now + expirationTime,
                                    html: event.html,
                                    etag: newEtag,
                                    lastModifiedAt: lastModifiedAt
                                }
                                // Release the child process for the next request
                                releaseChildProcess(child)
                                // Don't send content if etag is same
                                if (clientETag && clientETag == newEtag) {
                                    if (debugLogs) console.log('SERVER: Etag is same, return 304')
                                    return resolve(reply.code(304).send())
                                }
                                // Don't send content if content haven't been modified yet
                                if (clientLastModifiedSince && clientLastModifiedSince >= cached.lastModifiedAt) {
                                    if (debugLogs) console.log('SERVER: LastModifiedAt is same, return 304')
                                    return reply.code(304).send()
                                }
                                // Attach Etag header
                                reply.header('ETag', newEtag)
                                // Attach Last-Modified header if value is present
                                if (lastModifiedAt) {
                                    reply.header('Last-Modified', lastModifiedAt.toUTCString())
                                }
                                if (debugLogs) console.log('SERVER: Return newly rendered html')
                                // Send the response
                                resolve(reply.type('text/html').send(event.html))
                            }
                            // HTML is not present, it is serious server-side error
                            else {
                                console.error(message.error)
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
                    debugLogs: debugLogs,
                    path: path,
                    search: search,
                    serverPort: port,
                    pathToWasm: pathToWasm,
                    wasmMtime: wasmMtime
                })
            })
        }
        // Call the child process
        await workWithChild(child)
    })
    // Start the server
    const start = async () => {
        try {
            const options = { port: port }
            await fastify.listen(options)
            fastify.log.info(`Server listening on http://localhost:${options.port}`)
        } catch (err) {
            fastify.log.error(err)
            process.exit(1)
        }
    }
    // Call async start
    start()
}