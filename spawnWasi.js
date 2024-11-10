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

import { SwiftRuntime } from 'javascript-kit-swift'
import { WASI } from '@wasmer/wasi'
import { WasmFs } from '@wasmer/wasmfs'
import { loadDom } from './dom.js'

// Instantiates a new WebAssembly instance to render HTML pages
export async function spawnWasi(wasmBytes, path, search, serverPort, debugLogs, domHandler) {
    var starTime = debugLogs ? (new Date()).getMilliseconds() : undefined
    try {
        // Create virtual DOM
        const dom = loadDom(path, search, serverPort)
        if (debugLogs) console.log(`WASI: Instantiated DOM in ${(new Date()).getMilliseconds() - starTime}ms`)
        // Instantiate a new WASI Instance
        const wasmFs = new WasmFs()
        if (debugLogs) console.log(`WASI: Instantiated WasmFs in ${(new Date()).getMilliseconds() - starTime}ms`)
        // Checking if wasm file was built for `wasip1-threads`
        const wasip1Threads = process.env.CS_WASIP1_THREADS != undefined
        // Output stdout and stderr to console
        const originalWriteSync = wasmFs.fs.writeSync
        wasmFs.fs.writeSync = (fd, buffer, offset, length, position) => {
            const text = new TextDecoder('utf-8').decode(buffer)
            if (text !== '\n') {
                switch (fd) {
                case 1:
                    if (debugLogs) console.log(text)
                    break
                case 2:
                    if (debugLogs) console.error(text)
                    const prevLimit = Error.stackTraceLimit
                    Error.stackTraceLimit = 1000
                    Error.stackTraceLimit = prevLimit
                    break
                }
            }
            return originalWriteSync(fd, buffer, offset, length, position)
        }
        var bindings = { ...WASI.defaultBindings }
        const wasi = new WASI({
            args: [],
            env: {},
            bindings: {
                ...bindings,
                fs: wasmFs.fs
            }
        })
        const swift = new SwiftRuntime()
        if (debugLogs) console.log(`WASI: Instantiated SwiftRuntime in ${(new Date()).getMilliseconds() - starTime}ms`)
        const patchWASI = function (wasiObject) {
            const original_clock_res_get = wasiObject.wasiImport['clock_res_get']
            wasiObject.wasiImport['clock_res_get'] = (clockId, resolution) => {
                wasiObject.refreshMemory()
                return original_clock_res_get(clockId, resolution)
            }
            return wasiObject.wasiImport
        }
        var wasmImports = {}
        wasmImports.wasi_snapshot_preview1 = patchWASI(wasi)
        wasmImports.javascript_kit = swift.wasmImports
        wasmImports.__stack_sanitizer = {
            report_stack_overflow: () => {
                throw new Error('Detected stack buffer overflow.')
            }
        }
        const module = await WebAssembly.instantiate(wasmBytes, wasmImports)
        if (debugLogs) console.log(`WASI: Instantiated WebAssembly in ${(new Date()).getMilliseconds() - starTime}ms`)
        const instance = 'instance' in module ? module.instance : module
        if (swift && instance.exports.swjs_library_version) {
            swift.setInstance(instance)
        }
        var wasiAppStarted = false
        setTimeout(() => {
            if (!wasiAppStarted) {
                if (debugLogs) console.log(`WASI: wasiAppOnStart wasn't called in 5000ms (fatal)`)
                domHandler(undefined, 0, 0)
            }
        }, 5000)
        global.wasiAppOnStart = () => {
            wasiAppStarted = true
            if (debugLogs) console.log(`WASI: global.wasiAppOnStart in ${(new Date()).getMilliseconds() - starTime}ms`)
            if (global.wasiDisableLocationChangeListener) {
                if (debugLogs) console.log(`WASI: wasiDisableLocationChangeListener not implemented (non-critical)`)
                global.wasiDisableLocationChangeListener()
            }
            if (!global.wasiChangeRoute) {
                if (debugLogs) console.log(`WASI: wasiChangeRoute not implemented (fatal)`)
                domHandler(undefined, 0, 0)
            } else {
                global.wasiChangeRoute(path, search, (expiresIn, lastModifiedAt) => {
                    if (debugLogs) console.log(`WASI: rendered route in ${(new Date()).getMilliseconds() - starTime}ms`)
                    domHandler(dom, expiresIn, lastModifiedAt)
                })
            }
        }
        // Start the WebAssembly WASI instance
        wasi.start(instance)
        if (debugLogs) console.log(`WASI: wasi.start in ${(new Date()).getMilliseconds() - starTime}ms`)
        // Initialize and start Reactor
        if (instance.exports._initialize) {
            instance.exports._initialize()
            if (instance.exports.__main_argc_argv) {
                instance.exports.main = instance.exports.__main_argc_argv
            }
            instance.exports.main()
        }
        if (debugLogs) console.log(`WASI: instance.exports.main in ${(new Date()).getMilliseconds() - starTime}ms`)
    } catch (error) {
        console.error(`WASI: Error happened: ${error}`)
    }
}