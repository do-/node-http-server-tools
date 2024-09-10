![workflow](https://github.com/do-/node-http-server-tools/actions/workflows/main.yml/badge.svg)
![Jest coverage](./badges/coverage-jest%20coverage.svg)

`http-server-tools` is a thin wrapper around the standard [`'node:http'`](https://nodejs.org/api/http.html) library for developing Web services with as few external dependencies as possible, without resorting to a full blown middleware framework. Or to build such frameworks.

The main class here, `HttpRequestContext`, incapsulates the [`ClientRequest`](https://nodejs.org/api/http.html#class-httpclientrequest)/[`ServerResponse`](https://nodejs.org/api/http.html#class-httpserverresponse) pair and implements an OO API hiding some transport protocol details while keeping low level operation totally available. 

`HttpRequestContext` don't assume subclassing, but is highly configurable and is meant to be used together with companion objects carrying sets of options for its constructor. Such objects should be singletons representing local application's specifics as opposed to one-off multi purpose `HttpRequestContext` instances.

To illustrate `HttpRequestContext` API in action, a trivial embeddable file directory sharing Web server, [`HttpStaticSite`](https://github.com/do-/node-http-server-tools/wiki/HttpStaticSite), is included in the library.

# Installation
```sh
npm install http-server-tools
```
# Usage
```js
const createError          = require ('http-errors')
const {HttpRequestContext} = require ('http-server-tools')

async function handle (response) {

  const ctx = new HttpRequestContext (response, {

//    parse       : str => JSON.parse (str),        // for .bodyParams
//    stringify   : obj => JSON.stringify (obj),    // for .write ({...})
//    createError : err => createError (500, err, {expose: false}),

//    maxBodySize : 10 * 1024 * 1024,
//    pathBase    : 0,
//    pathMapping :       // e. g. ([type, id]) => ({type, id})
//    keepBody    :       // e. g. function () {return this.path [0] === 'huge'}

//    statusCode  : 200,
//    charset     : 'utf-8',
//    contentType :       // e. g. 'text/xml', 'application/soap+xml'

  })

  const {pathParams, searchParams} = ctx // from the URL
  const {sessionId}                = ctx.cookieParams
  
  await ctx.readBody ()      // if the method is 'GET' or `keepBody` returns true, does nothing
  const {bodyParams} = ctx   // see the `parse` option

  try {
    const result = await invokeMyBusinessMethod ({...pathParams,...searchParams, ...bodyParams}, sessionId)
    ctx.setCookie ('sessionId', sessionId, {httpOnly: true})
    await ctx.write (result)
  }
  catch (err) {
    await ctx.writeError (err)
  }

}

http.createServer ({...})
  .on ('request', (_, response) => 
    handle (response)
    .then (..., ...)
  )
  .listen ({...})
```
In essence, in most cases, to serve a request, one should:
* create an `HttpRequestContext` instance;
* fetch the request completely with `await ctx.readBody ()`;
* calculate the result based on `{...pathParams, ...searchParams, ...bodyParams}` and, probably, `cookieParams`;
* `ctx.write ()` it out.

# Reading Incoming Data
In most cases, to acquire the totality of data sent from the client, the boilerplate code
```js
  await ctx.readBody ()
  const {pathParams, searchParams, bodyParams, cookieParams: {sessionId}} = ctx 
  // now do something with {...pathParams, ...searchParams, ...bodyParams} and sessionId
```
should fit right. Details are explained below in this section.

## `.searchParams`
This property's value is an object composed from [url.searchParams](https://nodejs.org/api/url.html#urlsearchparams). For `/?type=users&id=1`, it's `{type: 'users', 'id': '1'}`.

## `.path`
This property presents the [`url.pathname`](https://developer.mozilla.org/en-US/docs/Web/API/URL/pathname), split by `'/'`, with all empty strings filtered away, with first `pathBase` stripped off. For example, for `http://127.0.0.1/api/v1.0//users/1/?show=1#help` it will be 

|`pathBase`|`path`|
| - | - |
|`0` (default)|`['api', 'v1.0', 'users', '1']`|
|`1`|`['v1.0', 'users', '1']`|
|`2`|`['users', '1']`|

## `.pathParams`
In many Web applications, components of the `path` with fixed positions have a clear business sense: for example, the root part means entity (name it `type`) and the second is the unique identifier (name it `id`): `/{type}/{id}`.

In such cases, `HttpRequestContext` lets configure a mapping function
```js
  pathMapping: ([type, id]) => ({type, id})
```
and obtain the corresponding named parameters, in the form of a plain Object, via the `.pathParams` property, similar to `.searchParams`.

Without `pathMapping` defined (which is the default), `.pathParams` is always an empty object `{}`.

## `.body`
Initially undefined, after `await ctx.readBody ()` this property becomes a [Buffer](https://nodejs.org/api/buffer.html#buffer) containing the whole request body.

If the [HTTP Request Method](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods) doesn't assume sending any body (`GET`, `HEAD` etc.), `.body` remains undefined.

The same happens for `'POST'`, `'PUT'` etc. when `.keepBody ()` returns `true`. By default, it never does but the developer might opt to alter it to read the `.request` stream explicitly. For example:
```js
  keepBody: function () {return this.searchParams.type === 'special'},
```
will keep `.request` unread for `/type=special` even after `await ctx.readBody ()` is done.

If the `maxBodySize` (10 Mb by default) limit gets exceeded, a [413 Content Too Large](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413) [http error](https://www.npmjs.com/package/http-errors) is thrown.

Overall, it's always safe to call `await ctx.readBody ()`, once per `ctx` instance.

## `.bodyText`
This computed property returns the `.body` as a string, decoded with [`Content-Type`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type)'s `charset`, 'utf-8' by default.

Exception: for an undefined `.body`, `.bodyText` returns the zero length string: `''`.

## `.bodyParams`
This computed property returns the result of applying the `parse` option (`JSON.parse` by default) to `.bodyText`.

Exception: for a zero length `.bodyText`, `.bodyParams` returns the empty object: `{}`.

So, for instance, `{...searchParams, ...bodyParams}` is OK for `GET` requests without additional checks.

For SOAP and other XML based services, it takes to redefine the `parse` option using something like [XMLParser](https://github.com/do-/node-xml-toolkit/wiki/XMLParser).

## `.cookieParams`
This property's getter is the shortcut to [cookie.parse ()](https://www.npmjs.com/package/cookie#cookieparsestr-options).

# Writing Results
In short, to send business `data` (normally, a plain object or, in special cases, a stream) to the client, the application should call
```js
await ctx.write (data)
```
once per HTTP request. This high level all purpose method actually just checks for its argument type and forwards it to one of the specific methods described hereafter.

Any of `write...` methods is presumed to be called once per request lifecycle, at its end. All custom HTTP headers (including `Set-Cookie`, see below) must be already set at this point.
 
The response status code is set from `ctx.statusCode` which is initially set by configuration, `200` by default.

## `writeEmpty`
Invoked by `write` for `undefined` incoming value. Writes an empty [204 No Content](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/204) response.

## `writeStream`
This method is directly invoked by `write` for a [Readable](https://nodejs.org/api/stream.html#readable-streams) incoming value. It basically just pipes the argument into `.response`, but, first, it writes HTTP headers, `ContentType` specifically.

To overwrite the default `application/octet-stream` type, there are three options:
* add the `[HttpRequestContext.CONTENT_TYPE]` property to the stream instance;
* set `ctx.contentType`;
* lowest level: explicitly call `ctx.response.setHeader ('content-length', ...)`.

## `writeBuffer`
Invoked by `write` for a [Buffer](https://nodejs.org/api/buffer.html) incoming value, writes the binary content supplied into `.response`.

The `ContentType` is controlled the same 3 ways as for `writeStream`, including the `[HttpRequestContext.CONTENT_TYPE]` property for the buffer.

## `writeText`
Invoked by `write` for a `string` incoming value. Unlike aforementioned methods, defaults `ContentType` to `text/plain`. Moreover, appends the `; charset=${charset}` unless it's already there. The same `charset` is used to translate the string into a Buffer to actually write out. One should have a really good reason to overwrite the default `charset: 'utf-8'`.

## `writeObject`
Invoked by `write` for a plain (not [Readable](https://nodejs.org/api/stream.html#readable-streams) nor [Buffer](https://nodejs.org/api/buffer.html)) object. Executes `stringify` to obtain the string representation and then uses `writeText` to do the rest. The `ContentType` is set to 'application/json'.

To build an SOAP service, `serialize` should be implemented with [XMLSchemata](https://github.com/do-/node-xml-toolkit/wiki/XMLSchemata) or like; and `contentType` must be set accordingly.

# Reporting Errors
The `writeError` method requires an `Error` object as an argument. Normally, it should be created with [`http-errors`](https://www.npmjs.com/package/http-errors). Otherwise, the local `createError` option is used to wrap it up first — it absolutely must return an `http-errors` augmented object. 

The result is written out with `writeText`. For a true `expose` value the text is the error's `message`; otherwise, just the status text is written.

As for any text, the `Content-Type` is `text/plain` by default, but it may me altered by setting `{headers: {'Content-Type': ...}}`.

For `writeError`, the `statusCode` is copied from the error object, overriding what was set for the context instance.

# Working with Cookies
`HttpRequestContext` wraps around the ultra popular [`cookie`](https://www.npmjs.com/package/cookie) module featuring:
* the `cookieParams` property for reading the `.request`'s [`Cookie`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cookie) header;
* the `setCookie (name, value, options)` method for writing the `.response`'s [`Set-Cookie`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie) header.

# Going Low Level
To perform any tasks uncovered by the methods described, `HttpRequestContext` provides the next properties:

Name | Type | Description | Possible use
-|-|-|-
`request` | [`ClientRequest`](https://nodejs.org/api/http.html#class-httpclientrequest) | The raw request | Processing the body as a stream; see `keepBody` option
`response` | [`ServerResponse`](https://nodejs.org/api/http.html#class-httpserverresponse) | The raw response | Setting headers
`url` | [`URL`](https://nodejs.org/api/url.html) | Parsed `request.url` | Reading non standard parameters
