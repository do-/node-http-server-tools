const Path = require ('path')
const {getResponse} = require ('./lib/MockServerStatic.js')

async function getResponseFromStaticSite (path, o = {}) {
	return getResponse ({path, ...o})
}

test ('dir', async () => {

	const rp = await getResponseFromStaticSite ('/')
	
	expect (rp.statusCode).toBe (200)
	expect (rp.responseText).toBe ('It worked')

})

test ('200', async () => {

	const rp = await getResponseFromStaticSite ('/index.html')
	
	expect (rp.statusCode).toBe (200)
	expect (rp.headers ['content-type']).toBe ('text/html')
	expect (rp.responseText).toBe ('It worked')

})

test ('no-type', async () => {

	const rp = await getResponseFromStaticSite ('/README')
	expect (rp.headers ['content-type']).toBe ('application/octet-stream')
	expect (rp.statusCode).toBe (200)

})

test ('unknown-type', async () => {

	const rp = await getResponseFromStaticSite ('/README.not')
	expect (rp.headers ['content-type']).toBe ('application/octet-stream')
	expect (rp.statusCode).toBe (200)

})

test ('404', async () => {

	const rp = await getResponseFromStaticSite ('/index.htm?id=1')
	expect (rp.statusCode).toBe (404)
	expect (Path.basename (rp.result.path)).toBe ('index.htm')

})