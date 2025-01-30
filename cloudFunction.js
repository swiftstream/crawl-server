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
import * as path from 'path'
import mime from 'mime'
import Fastify from 'fastify'
import { Server } from './server.js'

/// Method for cloud function
///
/// Options:
/// - pathToStaticFiles: required, path to folder with static files
/// - pathToWasm: required, e.g. ${pathToStaticFiles}/app.wasm
/// - indexFile: optional, main.html by default
/// - logger: optional object with two methods { log: (msg), error: (msg) }
/// - numberOfChildProcesses: optional, 4 by defauls
/// - customBots: optional, array with lowercased bot names
export function setupCloudFunction(options) {
    if (!options.pathToStaticFiles) throw `setupCloudFunction: missing 'pathToStaticFiles' in options`
    if (!options.pathToWasm) throw `setupCloudFunction: missing 'pathToWasm' in options`

    const indexFile = options.indexFile ?? 'main.html'
    const enableLogs = options.logger ? true : undefined
    let logger = options.logger
    if (logger && !logger.log) logger.log = console.log
    if (logger && !logger.error) logger.log = console.error

    const fastify = Fastify({ logger: enableLogs })
    const server = new Server({
        pathToWasm: options.pathToWasm,
        port: 8080,
        debugLogs: enableLogs,
        numberOfChildProcesses: options.numberOfChildProcesses ?? 4,
        bindGlobally: true,
        fastify: fastify,
        logger: logger,
        stateHandler: (s) => {
            if (logger) logger.log(s)
        }
    })

    // Function to detect search engine crawlers
    const isCrawler = (userAgent) => {
        if (!userAgent) return false

        // Converts User-Agent to lowercase for case-insensitive matching
        const userAgentLower = userAgent.toLowerCase()

        // List of bots
        const bots = options.customBots ?? [
            'linkedinbot',
            'googlebot',
            'yahoo',
            'bingbot',
            'baiduspider',
            'yandex',
            'yeti',
            'yodaobot',
            'gigabot',
            'ia_archiver',
            'facebookexternalhit',
            'twitterbot',
            'developers.google.com',
            'slurp',
            'duckduckbot',
            'sogou',
            'exabot',
            'semrushbot',
            'applebot',
            'mj12bot',
            'ahrefsbot',
            'rogerbot',
            'seznambot',
            'pinterestbot',
            'whatsapp',
            'skypeuripreview',
            'telegrambot',
            'discordbot',
            'slackbot'
        ]

        // Checks if the User-Agent contains any known bot identifiers
        return bots.some((bot) => userAgentLower.includes(bot))
    }

    // Define the wildcard route
    fastify.get('/*', (req, reply) => {
        const userAgent = req.headers['user-agent'] || ''
        const requestedPath = req.url
        const filePath = path.join(options.pathToStaticFiles, requestedPath)
        // Serve wasm for crawlers
        if (isCrawler(userAgent)) {
            return server.requestHandler(req, reply)
        }
        // Serve static files normally
        if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
            const mimeType = mime.getType(filePath) || 'application/octet-stream'
            reply.type(mimeType)
            return reply.send(fs.createReadStream(filePath))
        }
        // If it's not a file, serve index.html for frontend routing (SPA behavior)
        const indexPath = path.join(options.pathToStaticFiles, indexFile)
        if (fs.existsSync(indexPath)) {
            const mimeType = mime.getType(indexPath) || 'application/octet-stream'
            reply.type(mimeType)
            return reply.send(fs.createReadStream(indexPath))
        }
        reply.status(404).send(`${indexPath} not found`)
    })

    return server
}