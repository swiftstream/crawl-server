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

const consoleLogger = { log: (m) => console.log(m), error: (m) => console.error(m) }

if (process.env.CS_PATH_TO_WASM && process.env.CS_SERVER_PORT) {
    const started = await start(
        process.env.CS_PATH_TO_WASM,
        process.env.CS_SERVER_PORT,
        process.env.CS_DEBUG ? consoleLogger : undefined,
        process.env.CS_CHILD_PROCESSES,
        process.env.CS_GLOBAL_BIND
    )
    if (started.errorCode) {
        switch (started.errorCode) {
            case 0:
                process.exit(10) // Path to WASM is undefined
            case 1:
                process.exit(20) // Unable to start. Wasm file not found.
            case 2:
                process.exit(30) // Fastify failed to start.
            default:
                process.exit(1) // Unexpected state.  
        }
    }
}
export async function startServer(pathToWasm, options) {
    return await start(pathToWasm, options.port, options.debug ? consoleLogger : undefined, options.numberOfInstances, options.bindGlobally, options.stateHandler)
}