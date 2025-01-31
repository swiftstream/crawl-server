import { setupCloudFunction } from './cloudFunction.js'
import { fileURLToPath } from 'url'
import * as fs from 'fs'
import * as path from 'path'

// Server instance
var server = undefined
var config = undefined

const firebaseConfig = (importMetaUrl, logger) => {
    logger.log(`firebaseConfig importMetaUrl: ${importMetaUrl}`)
    const __filename = fileURLToPath(importMetaUrl)
    logger.log(`firebaseConfig __filename: ${__filename}`)
    const __dirname = path.dirname(__filename)
    logger.log(`firebaseConfig __dirname: ${__dirname}`)
    const configPath = path.join(__dirname, '../firebase.json')
    logger.log(`firebaseConfig configPath: ${configPath}`)
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (!config.hosting) throw 'Missing \'hosting\' configuration in ../firebase.json'
    if (!config.hosting.public || config.hosting.public.trim().length == 0) throw 'Missing \'hosting.public\' value in ../firebase.json'
    if (!config.hosting.wasm || config.hosting.wasm.trim().length == 0) throw 'Missing \'hosting.wasm\' value in ../firebase.json'
    if (!config.hosting.index || config.hosting.index.trim().length == 0) throw 'Missing \'hosting.index\' value in ../firebase.json'
    if (!config.hosting.index.endsWith('.html')) throw '\'hosting.index\' value in ../firebase.json: should end with .html'
    if (config.hosting.crawlers && config.hosting.crawlers.trim().length > 0) {
        const t = config.hosting.crawlers.split(',')
        if (t.length > 0) customBots = t
    }
    config.staticFilesDir = path.join(__dirname, `../${config.hosting.public}`)
}

export const handleRenderRequest = async (importMetaUrl, logger, req, reply, customBots, numberOfChildProcesses) => {
    if (!config) firebaseConfig(importMetaUrl, logger)
    if (!server) {
        server = setupCloudFunction({
            pathToStaticFiles: config.staticFilesDir,
            pathToWasm: path.join(config.staticFilesDir, `${config.hosting.wasm}.wasm`),
            indexFile: config.hosting.index,
            logger: logger,
            numberOfChildProcesses: numberOfChildProcesses, // 4 by default
            customBots: customBots
        })
    }
    await server.fastify.ready()
    server.fastify.server.emit('request', req, reply)
}