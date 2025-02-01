import { setupCloudFunction } from './cloudFunction.js'
import { fileURLToPath } from 'url'
import * as fs from 'fs'
import * as path from 'path'

// Server instance
var server = undefined
var config = undefined

const firebaseConfig = (importMetaUrl) => {
    const __filename = fileURLToPath(importMetaUrl)
    const __dirname = path.dirname(__filename)
    const configPath = path.join(__dirname, 'firebase.json')
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (!config.hosting) throw 'Missing \'hosting\' configuration in ../firebase.json'
    if (!config.hosting.public || config.hosting.public.trim().length == 0) throw 'Missing \'hosting.public\' value in ../firebase.json'
    if (!config.hosting.wasm || config.hosting.wasm.trim().length == 0) throw 'Missing \'hosting.wasm\' value in ../firebase.json'
    if (config.hosting.crawlers && config.hosting.crawlers.trim().length > 0) {
        const t = config.hosting.crawlers.split(',')
        if (t.length > 0) customBots = t
    }
    config.pathToWasm = path.join(__dirname, `${config.hosting.wasm}.wasm`)
    config.staticFilesDir = path.join(__dirname, `../${config.hosting.public}`)
}

export const handleRenderRequest = async (importMetaUrl, logger, req, reply, customBots, numberOfChildProcesses) => {
    if (!config) firebaseConfig(importMetaUrl)
    if (!server) {
        server = setupCloudFunction({
            importMetaUrl: importMetaUrl,
            pathToWasm: config.pathToWasm,
            logger: logger,
            numberOfChildProcesses: 1, // 4 by default
            customBots: customBots
        })
    }
    await server.fastify.ready()
    server.fastify.server.emit('request', req, reply)
}