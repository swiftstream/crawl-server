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
import { spawnWasi } from './spawnWasi.js'
import { exit } from 'process'

process.on('message', async (event) => {
    switch (event.type) {
        case 'render':
            const { path, search, pathToWasm, serverPort, debugLogs, wasmMtime } = event
            if (process.wasmMtime && wasmMtime) {
                if (debugLogs) console.log('PROCESS: Compare modification dates')
                if (debugLogs) console.dir({
                    newWasmModifiedAt: event.wasmMtime,
                    cachedWasmModifiedAt: process.wasmMtime
                })
                const isSame = wasmMtime === process.wasmMtime
                if (!isSame) {
                    if (debugLogs) console.log('PROCESS: Wasm file has been modified, sending restart event')
                    return process.send({ type: 'restart' })
                } else {
                    if (debugLogs) console.log('PROCESS: Wasm file not modified, going to render the page')
                }
            }
            // Set initial mtime for wasm file
            if (process.wasmMtime === undefined) {
                if (!pathToWasm) {
                    process.send({
                        type: 'crash',
                        reason: 'Path to wasm is undefined.'
                    })
                    exit(1)
                }
                if (!fs.existsSync(pathToWasm)) {
                    process.send({
                        type: 'crash',
                        reason: `Wasm not found at: ${pathToWasm}`
                    })
                    exit(2)
                }
                process.wasmMtime = fs.statSync(pathToWasm).mtime.getTime()
                process.wasmBytes = fs.readFileSync(pathToWasm)
                if (debugLogs) console.log('PROCESS: Load wasm instance in child process first time')
                await spawnWasi(process.wasmBytes, path, search, serverPort, event.debugLogs, (dom, expiresIn, lastModifiedAt) => {
                    process.dom = dom
                    if (debugLogs) console.log('PROCESS: Page rendered for the first time')
                    // Send the generated HTML back to the parent process
                    process.send({
                        type: 'render',
                        expiresIn: expiresIn,
                        lastModifiedAt: lastModifiedAt,
                        html: process.dom.serialize()
                    })
                })
            } else {
                if (debugLogs) console.log('PROCESS: Reuse existing wasm instance')
                global.wasiChangeRoute(path, search, (expiresIn, lastModifiedAt) => {
                    if (debugLogs) console.log('PROCESS: Page rendered (reused instance)')
                    // Send the generated HTML back to the parent process
                    process.send({
                        type: 'render',
                        expiresIn: expiresIn,
                        lastModifiedAt: lastModifiedAt,
                        html: process.dom.serialize()
                    })
                })
            }
            break
        default: break
    }
})