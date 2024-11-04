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

import { JSDOM } from 'jsdom'

// Creates a virtual DOM for the WebAssembly instance
export function loadDom(pathname, search, serverPort) {
    // Skeleton
    const dom = new JSDOM(
        '<!DOCTYPE html><html lang="en-US"><head><title >&lrm;</title><meta charset="utf-8"></head><body></body></html>',
        {
            pretendToBeVisual: true,
            runScripts: 'dangerously',
            resources: 'usable'
        })
    // Assign window
    global.window = dom.window
    // Fill required values
    global.window.location.pathname = pathname
    global.window.location.search = search
    global.window.location.hash = ''
    // Mock required parts
    global.window.alert = (args) => {}
    global.window.matchMedia = (query) => { return { onchange: () => {}, matches: true }}
    global.document = window.document
    global.history = {
        back: () => {},
        forward: () => {},
        go: (offset) => {},
        pushState: (data, title, path) => {},
        replaceState: (data, title, path) => {},
    }
    global.location = {
        hash: '',
        host: `0.0.0.0:${serverPort}`,
        hostname: '0.0.0.0',
        href: `http://0.0.0.0:${serverPort}/${pathname}`,
        origin: `http://0.0.0.0:${serverPort}`,
        pathname: pathname,
        port: `${serverPort}`,
        protocol: 'http',
        search: search,
        assign: () => {},
        reload: () => {},
        replace: () => {}
    }
    return dom
}