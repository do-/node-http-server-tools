const fs                 = require ('fs')
const Path               = require ('path')
const createError        = require ('http-errors')
const HttpRequestContext = require ('./HttpRequestContext')

class HttpStaticSite {

	constructor (options) {
	
		this.root  = options.root
		this.index = options.index ?? 'index.html'
		
		this.mime = new Map (this.ext2mime ())

	}
	
	* ext2mime () {

		for (const [type, {extensions}] of Object.entries (require ('mime-db'))) 
		
			if (extensions)
			
				for (const extension of extensions)
				
					yield [extension, type]

	}

	assertExists (path) {

		if (fs.existsSync (path)) return

		const err = createError (404)

		err.path = path

		throw err

	}

	getMimeType (path) {

		const ext = Path.extname (path); if (!ext) return

		return this.mime.get (ext.slice (1))

	}

	getFilePath (url) {

		let path = Path.join (this.root, url.pathname)

		this.assertExists (path)

		if (!fs.statSync (path).isDirectory ()) return path

		path = Path.join (path, this.index)

		this.assertExists (path)

		return path

	}

	getStream (path) {

		const result = fs.createReadStream (path)

		result [HttpRequestContext.CONTENT_TYPE] = this.getMimeType (path)

		return result

	}

	async handle (response) {

		const ctx = new HttpRequestContext (response)

		try {

			const filePath = this.getFilePath (ctx.url)

			const stream = this.getStream (filePath)

			await ctx.write (stream)

		}
		catch (err) {

			await ctx.writeError (err)

			throw err

		}

	}

}

module.exports = HttpStaticSite