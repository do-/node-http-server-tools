const {URL} = require ('url')
const {Readable} = require ('stream')
const createError = require ('http-errors')
const status = require ('statuses')
const cookie = require ('cookie')

const CH_P = 'P'.charCodeAt (0)

const DEFAULT_KEEP_BODY    = () => false
const DEFAULT_PARSE        = s => JSON.parse (s)
const DEFAULT_CREATE_ERROR = e => createError (500, e, {expose: false})
const DEFAULT_STRINGIFY    = o => JSON.stringify (o)

const CONTENT_TYPE                = 'Content-Type'
const DEFAULT_OBJECT_CONTENT_TYPE = 'application/json'
const DEFAULT_BINARY_CONTENT_TYPE = 'application/octet-stream'
const DEFAULT_TEXT_CONTENT_TYPE   = 'text/plain'
const DEFAULT_CHARSET             = 'utf-8'

class HttpRequestContext {

	constructor (response, options = {}) {

		this.request     = response.req
		this.response    = response

		this.keepBody    = options.keepBody    ?? DEFAULT_KEEP_BODY
		this.maxBodySize = options.maxBodySize ?? 10 * 1024 * 1024
		this.pathBase    = options.pathBase    ?? 0
		this.pathMapping = options.pathMapping
		this.parse       = options.parse       ?? DEFAULT_PARSE

		this.stringify   = options.stringify   ?? DEFAULT_STRINGIFY
		this.createError = options.createError ?? DEFAULT_CREATE_ERROR

		this.contentType = options.contentType
		this.charset     = options.charset     ?? DEFAULT_CHARSET

		this.statusCode  = options.statusCode  ?? 200


	}

	get url () {

		const {request} = this, value = new URL (request.url, `http://${request.headers.host}`)
		
		Object.defineProperty (this, 'url', {value, writable: false})

		return value

	}

	get path () {

		const value = this.url.pathname.split ('/').filter (s => s.length !== 0).slice (this.pathBase)

		Object.defineProperty (this, 'path', {value, writable: false})

		return value

	}

	get pathParams () {

		const {pathMapping} = this, value = pathMapping ? pathMapping (this.path) : {}
		
		Object.defineProperty (this, 'pathMapping', {value, writable: false})

		return value

	}

	get searchParams () {

		const value = Object.fromEntries (this.url.searchParams)

		Object.defineProperty (this, 'searchParams', {value, writable: false})

		return value

	}

	get hasBody () {

		return this.request.method.charCodeAt (0) === CH_P && !this.keepBody ()

	}

	async readBody () {
	
		const {request, hasBody, maxBodySize} = this; if (!hasBody) return

		{

			const length = request.headers ['content-length']

			if (length && BigInt (length) > maxBodySize) throw createError (413)

		}

		let buffers = [], totalLength = 0; await new Promise ((ok, fail) => request
			.on ('error', fail)
			.on ('end', ok)
			.on ('data', buffer => {

				totalLength += buffer.length

				if (totalLength < maxBodySize) {
					buffers.push (buffer)
				}
				else {
					request.pause ()
					fail (createError (413))
				}

			}))

		this.body = Buffer.concat (buffers, totalLength)
	
	}

	get bodyText () {

		const {body} = this; if (body == null) return ''

		const {request: {headers}} = this

		let {charset} = cookie.parse (headers ['content-type'] ?? '')
		
		const value = body.toString (charset)

		Object.defineProperty (this, 'bodyText', {value, writable: false})

		return value

	}

	get bodyParams () {

		const {bodyText} = this, value = bodyText === '' ? {} : this.parse (bodyText)

		Object.defineProperty (this, 'bodyParams', {value, writable: false})

		return value

	}

	get cookieParams () {

		const value = cookie.parse (this.request.headers.cookie ?? '')

		Object.defineProperty (this, 'cookieParams', {value, writable: false})

		return value

	}

	setCookie (name, value, options) {

		this.response.setHeader ('Set-Cookie', cookie.serialize (name, value, options))

	}

	pipeStream (os) {

		const {response} = this

		if (!response.hasHeader (CONTENT_TYPE)) response.setHeader (CONTENT_TYPE, this.contentType ?? DEFAULT_BINARY_CONTENT_TYPE)
		
		response.writeHead (this.statusCode)

		os.pipe (response)

	}

	async writeStream (os) {

		const {response} = this

		return new Promise ((ok, fail) => {

			response.on ('error', fail)
			
			os.on ('error', fail)

			response.on ('close', ok)

			this.pipeStream (os)

		})

	}
	
	async writeBuffer (b) {
	
		this.response.setHeader ('Content-Length', b.length)

		return this.writeStream (Readable.from (b))

	}
	
	async writeText (s) {

		if (!this.contentType) {
			
			this.contentType = this.response.getHeader (CONTENT_TYPE) ?? DEFAULT_TEXT_CONTENT_TYPE

			this.response.removeHeader (CONTENT_TYPE)

		}

		const {charset} = this, SEP = '; charset='

		if (this.contentType.indexOf (SEP) === -1) this.contentType += SEP + charset

		return this.writeBuffer (Buffer.from (s, charset))

	}

	async writeObject (o) {

		if (!this.contentType) this.contentType = this.response.getHeader (CONTENT_TYPE) ?? DEFAULT_OBJECT_CONTENT_TYPE

		return this.writeText (this.stringify (o))

	}

	async writeEmpty () {

		const {response} = this

		response.statusCode = 204

		response.end ()

	}

	async write (data) {
	
		if (data === undefined) {

			this.writeEmpty ()

		}
		else if (data instanceof Readable) {

			await this.writeStream (data)

		}
		else if (Buffer.isBuffer (data)) {

			await this.writeBuffer (data)

		}
		else if (typeof data === 'string') {

			await this.writeText (data)

		}
		else if (typeof data === 'object') {

			await this.writeObject (data)

		}
		else {

			throw Error ('Unknown data type to write: ' + data)

		}

	}

	async writeError (e) {

		if (!(e instanceof Error)) throw Error ('Not an Error: ' + e)

		if (!createError.isHttpError (e)) e = this.createError (e)
		
		if (!createError.isHttpError (e)) throw Error ('Not an HTTP Error: ' + e)

		this.statusCode  = e.statusCode

		const {headers} = e; if (headers) for (const k in headers) this.response.setHeader (k, headers [k])

		await this.writeText (e.expose ? e.message : status (e.status))

	}

}

module.exports = HttpRequestContext