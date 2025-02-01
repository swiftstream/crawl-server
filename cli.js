#!/usr/bin/env node

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

import { start } from './server.js'
import { Command } from 'commander'
const program = new Command()

program
    .name('crawlserver')
    .description('Efficient SEO-focused server for Wasm-generated pages')
    .version('1.7.0')
    .argument('[path]', 'Path to the WebAssembly application file')
    .option('-p, --port <port>', 'Port for the server to listen on')
    .option('-c, --child-processes <child_processes>', 'Number of concurrent WebAssembly instances to spawn (default: 4)')
    .option('-d, --debug', 'Enable debug logs')
    .option('-g, --global', 'Bind to 0.0.0.0')
    .action(async (path, options) => {
        const started = await start(
            path ?? process.env.CS_PATH_TO_WASM,
            options.port ?? process.env.CS_SERVER_PORT,
            options.debug ?? process.env.CS_DEBUG,
            options.child_processes ?? process.env.CS_CHILD_PROCESSES,
            options.global ?? process.env.CS_GLOBAL_BIND
        )
        if (started.errorCode) {
            switch (started.errorCode) {
                case 0:
                    console.error('Path to WASM is undefined')
                    process.exit(10) // Path to WASM is undefined.
                case 1:
                    console.error('Unable to start. Wasm file not found.')
                    process.exit(20) // Unable to start. Wasm file not found.
                case 2:
                    console.error('Fastify failed to start.')
                    process.exit(30) // Fastify failed to start.
                default:
                    console.error('Unexpected state.')
                    process.exit(1) // Unexpected state.
            }
        }
    })

program.parse(process.argv)