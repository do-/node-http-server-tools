const http = require ('http')
const {HttpStaticSite} = require ('../..')
const Path             = require ('path')

let port = 8110

const site = new HttpStaticSite ({root: Path.join (__dirname, '../data')})

module.exports = {

	getResponse: async function (o) {

		if (!o.listen) o.listen = {}
		if (!o.listen.host) o.listen.host = '127.0.0.1'
		if (!o.listen.port) o.listen.port = ++ port

		if (!o.requestOptions) o.requestOptions = {}
		if (o.requestOptions.body == null) o.requestOptions.body = ''

		const {listen, path, requestOptions} = o

		let server

		try {

			const pRq = new Promise ((ok) => {

				server = http.createServer (o.server || {})

				.on ('request', (_, response) => {

					site.handle (response).then (ok, ok)

				})
				
				server.listen (listen)

			})
			
			const pRp = new Promise (ok => {

				const rq = http.request (`http://${listen.host}:${listen.port}${path}`, requestOptions, ok)
	
				rq.end (requestOptions.body)
	
			})

			const [rp, result] = await Promise.all ([pRp, pRq])
	
			const a = []; for await (b of rp) a.push (b)

			rp.responseText = Buffer.concat (a).toString ()
			rp.result = result

			return rp

		}
		catch (err) {

			console.log (err)

		}
		finally {

			server.close ()

		}

	}

}