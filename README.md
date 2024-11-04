# Server-Side Renderer for WebAssembly Applications to Enable Search Engine Indexing

This server loads a WebAssembly Swift app, spawns multiple instances, and serves the generated HTML, enabling search engines to index the site as standard HTML without modifying the WebAssembly app.

This package is part of a Swift Stream VSCode extension.

## 👨‍🔧 Usage

It is designed to be used either as a standalone server or as an imported module within a project.

### Standalone

To run as a standalone server, configure it with environment variables:

- **`SS_PATH_TO_WASM`**: Path to the WebAssembly application file.
- **`SS_SERVER_PORT`**: Port for the server to listen on.
- **`SS_DEBUG`**: Set to `TRUE` to enable debug logs.
- **`SS_CHILD_PROCESSES`**: Number of concurrent WebAssembly instances to spawn (default: 4).

### Module

To use as an imported module, install it and call the `start()` method:

```js
import { start } from 'crawl-server'

start(
    '/path/to/app.wasm', // path to the WebAssembly application file
    3000,                // port
    false,               // debug logs
    4                    // number of concurrent WebAssembly instances to spawn
)
```

## 💨 Workflow

- **Request Handling**: Each incoming request is routed through Fastify, which first checks if there’s a cached response.
- **Caching**: If a response is cached and still valid, the server responds directly with the cached HTML and `ETag`.
- **Rendering**: If the response is not cached or has expired, the server uses a child process to execute the WebAssembly app, render the HTML, and cache the result.
- **Headers**: Each response includes `ETag` and `Last-Modified` headers for effective caching by clients.

## 🚀 Performance

- **Cold Start**: Initializing a new WebAssembly process takes approximately 300ms.
- **Warm Call**: Subsequent calls to an active WebAssembly instance take about 100ms.
- **Cached Response**: Serving directly from the cache takes roughly 1ms.

This setup ensures fast, SEO-optimized responses for search engine crawlers, balancing performance and resource management.

## 🙇‍♂️ Contributing

Contributions are welcome! Please feel free to fork the repository and submit a pull request.

## 🧾 License

This project is licensed under the MIT License.