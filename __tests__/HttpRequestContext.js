const {getResponse} = require ('./lib/MockServer.js')
const {HttpRequestContext} = require ('..')
const createError = require ('http-errors')

async function getResponseFromServer (path, o = {}) {
	return getResponse ({path, ...o})
}

test ('bad', async () => {

	const ctx = new HttpRequestContext ({}, {
		createError: () => 0
	})

	await expect (() => ctx.write (0)).rejects.toBeDefined ()
	await expect (() => ctx.writeError (0)).rejects.toBeDefined ()
	await expect (() => ctx.writeError (Error ())).rejects.toBeDefined ()

})

test ('get', async () => {

	const rp = await getResponseFromServer ('/', {
		cb: async ctx => {
			ctx.response.setHeader ('content-type', 'text/extraordinary')
			await ctx.write (JSON.stringify (ctx.bodyParams))
		} 
	})

	expect (rp.statusCode).toBe (200)
	expect (rp.responseText).toBe ('{}')
	expect (rp.headers ['content-type']).toBe ('text/extraordinary')

})

test ('buffer', async () => {

	const rp = await getResponseFromServer ('/?code=65', {
		cb: async ctx => {
			await ctx.write (Buffer.from ([parseInt (ctx.searchParams.code) + Object.entries (ctx.cookieParams).length]))
		} 
	})

	expect (rp.statusCode).toBe (200)
	expect (rp.responseText).toBe ('A')
	expect (rp.headers ['content-type']).toBe ('application/octet-stream')

})

test ('post', async () => {

	const rp = await getResponseFromServer ('/user/1/?action=delete', {
		requestOptions: {
			method: 'POST', 
			body: '{"label": "A"}',
			headers: {Cookie: 'session=0; user=1'},
		}, 
		cb: async ctx => {
			await ctx.readBody ()
			const {searchParams, bodyParams, cookieParams} = ctx
			ctx.setCookie ('session', cookieParams.session, {maxAge: 1000})
			await ctx.write ({searchParams, bodyParams})
		}
	})

	expect (rp.statusCode).toBe (200)
	expect (JSON.parse (rp.responseText)).toStrictEqual ({
		searchParams: {action: 'delete'}, 
		bodyParams: {label: "A"},
	})
	expect (rp.headers ['content-type']).toBe ('application/json; charset=utf-8')
	expect (rp.headers ['cookie']).toBe ('session=0; Max-Age=1000')

})

test ('echo', async () => {

	const body = 'Hi there?'

	const rp = await getResponseFromServer ('/?id=1', {requestOptions: {method: 'POST', body}, 
		ctxOptions: {
			statusCode: 202,
			keepBody: function () {return this.searchParams.id == 1}
		},
		cb: async ctx => {
			await ctx.readBody ()
			ctx.request [HttpRequestContext.CONTENT_TYPE] = 'application/quintet-stream'
			await ctx.write (ctx.request)
		}
	})

	expect (rp.statusCode).toBe (202)
	expect (rp.responseText).toBe (body)
	expect (rp.headers ['content-type']).toBe ('application/quintet-stream')

})

test ('405', async () => {

	const rp = await getResponseFromServer ('/?id=1', {
		cb: async ctx => {
			if (ctx.hasBody) {
				await ctx.write ("OK")
			}
			else {
				const e = createError (405)
				e [HttpRequestContext.CONTENT_TYPE] = 'text/cursed'
				await ctx.writeError (e)
			}
		}
	})

	expect (rp.statusCode).toBe (405)
	expect (rp.responseText).toBe ('Method Not Allowed')
	expect (rp.headers ['content-type']).toBe ('text/cursed; charset=utf-8')

})

test ('500', async () => {

	const rp = await getResponseFromServer ('/?id=1', {
		cb: async ctx => {
			await ctx.writeError (Error ('DEBUG'))
		}
	})

	expect (rp.statusCode).toBe (500)
	expect (rp.responseText).toBe ('Internal Server Error')
	expect (rp.headers ['content-type']).toBe ('text/plain; charset=utf-8')

})


test ('xml', async () => {

	const rp = await getResponseFromServer ('/', {
		ctxOptions: {
			contentType: 'text/xml; charset=utf-7'
		},
		cb: async ctx => {
			await ctx.write ('<?xml?..>')
		} 
	})

	expect (rp.statusCode).toBe (200)
	expect (rp.responseText).toBe ('<?xml?..>')
	expect (rp.headers ['content-type']).toBe ('text/xml; charset=utf-7')

})

test ('xml_dump', async () => {

	const rp = await getResponseFromServer ('/', {
		ctxOptions: {
			contentType: 'text/xml',
			stringify: o => `<o id="${o.id}">`
		},
		cb: async ctx => {
			await ctx.write ({id: 2})
		} 
	})

	expect (rp.statusCode).toBe (200)
	expect (rp.responseText).toBe ('<o id="2">')
	expect (rp.headers ['content-type']).toBe ('text/xml; charset=utf-8')

})

test ('big post', async () => {

	const rp = await getResponseFromServer ('/?id=1', {requestOptions: {method: 'POST', body: '{"label": "A"}'}, 
		ctxOptions: {
			maxBodySize: 1,
		},
		cb: async ctx => {

			try {
				await ctx.readBody ()
				const {searchParams, bodyParams} = ctx
				await ctx.write ({searchParams, bodyParams})	
			}
			catch (err) {
				await ctx.writeError (err)
			}

		}
	})

	expect (rp.statusCode).toBe (413)

})
