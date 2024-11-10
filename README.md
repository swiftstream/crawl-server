# Server-Side Renderer for WebAssembly Applications to Enable Search Engine Indexing

This server loads a WebAssembly Swift app, spawns multiple instances, and serves the generated HTML, enabling search engines to index the site as standard HTML without modifying the WebAssembly app.

This package is part of a Swift Stream VSCode extension.

## 👨‍🔧 Usage

It is designed to be used either as a standalone server or as an imported module within a project.

### Standalone

#### Via node

To run as a standalone server, configure it with environment variables:

- **`CS_PATH_TO_WASM`**: Path to the WebAssembly application file.
- **`CS_SERVER_PORT`**: Port for the server to listen on.
- **`CS_CHILD_PROCESSES`**: Number of concurrent WebAssembly instances to spawn (default: 4).
- **`CS_DEBUG`**: Set to `TRUE` to enable debug logs.
- **`CS_GLOBAL_BIND`**: Set to `TRUE` to bind to 0.0.0.0.

And then run from its folder as `npm run start` or `node main.js`.

#### CLI tool

Make sure to install `crawl-server` globally using:
```bash
npm install -g crawl-server
```

Then, you can run it as follows:

- Basic usage: `crawlserver /path/to/app.wasm`
- Using environment variables: `crawlserver`
- With all options specified: `crawlserver /path/to/app.wasm -p 3322 -c 4 -d -g`

##### CLI Arguments and Options

```bash
Arguments:
  path                   Path to the WebAssembly application file

Options:
  -V, --version          Output the version number
  -p, --port             Port for the server to listen on
  -c, --child-processes  Number of concurrent WebAssembly instances to spawn (default: 4)
  -d, --debug            Enable debug logs
  -g, --global           Bind to 0.0.0.0
  -h, --help             Display help for command
```

### Module

To use as an imported module, install it and call the `start()` method:

```js
import { start } from 'crawl-server'

start(
  '/path/to/app.wasm',             // path to the WebAssembly application file
  {                                // options:
    port: 3000,                    //   port
    debug: true,                   //   debug logs
    bindGlobally: true,            //   bind to 0.0.0.0
    numberOfInstances: 4,          //   number of concurrent WebAssembly instances to spawn
    stateHandler: (e) => {         //   listen for state changes
      console.log(e.state)         //   operating, stopping, failing
      console.log(e.description)   //   human readable description of the situation
      console.log(e.situation)     //   situations: server_started
                                   //               stopped_child_process
                                   //               wasm_missing
                                   //               disasterly_crashed
                                   //               respawned_after_disaster
                                   //               html_rendered
                                   //               html_not_rendered
                                   //               request_failed
                                   //               fulfilled_stop_call
    }
  }
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

## ⚡️ WASI-side Implementation

When your app starts, call `wasiAppOnStart()` which is available in JS global scope.

Optionally, implement `wasiDisableLocationChangeListener` method in JS global scope, it'll be called to disable the default router in your app.

Implement `wasiChangeRoute` in JS global scope to handle route changes within your app.

The server will call wasiChangeRoute as follows:
```javascript
global.wasiChangeRoute(
    path,                // route path, e.g. /articles/1
    query,               // query part, e.g. firstName=John&lastName=Smith
    (                    // `rendered` handler, it should be called once page is fully rendered
        expiresIn,       // optional, in what time (in seconds) this content will be expired
        lastModifiedAt   // optional, e.g. article createdAt/editedAt unix timestamp (in seconds from 1970)
    ) => {
    // here server renders HTML and returns it to the search engine crawler
})
```

## 🙇‍♂️ Contributing

Contributions are welcome! Please feel free to fork the repository and submit a pull request.

## 🧾 License

This project is licensed under the MIT License.
