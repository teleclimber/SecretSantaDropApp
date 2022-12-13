import {
	createApp,
	RoutesBuilder,
	AuthAllow,
	MigrationsBuilder} from 'https://deno.land/x/dropserver_app@v0.2.1/mod.ts';
import type {Context} from 'https://deno.land/x/dropserver_app@v0.2.1/mod.ts';
import { renderFile } from 'https://deno.land/x/mustache_ts@v0.4.1.1/mustache.ts';

// We'll store the pairs in pairings.txt
function getPairingsFile() {
	return app.appspacePath('pairings.txt');
}

// The migration will create the pairings file so we can always assume it's present
const m = new MigrationsBuilder;
m.upTo(1, async() => {
	await Deno.writeTextFile(getPairingsFile(), JSON.stringify({}));
});
m.downFrom(1, async() => {
	await Deno.remove(getPairingsFile());
});

// generated returns true if the pairings are generated
// and the users in pairings match users in appspace
async function generated() :Promise<boolean> {
	const p = await readPairings();
	const genP = Object.keys(p).sort();
	if( genP.length === 0 ) return false;

	const usersP = (await app.getUsers()).map( u => u.proxyId ).sort();
	if( usersP.length !== genP.length ) return false;
	for( let i=0; i<usersP.length; ++i ) {
		if( usersP[i] !== genP[i] ) return false;
	}
	return true;
}

// readPairings returns the pairs found in the pairings file
async function readPairings() : Promise<Record<string,string>> {
	const txt = await Deno.readTextFile(getPairingsFile());
	return JSON.parse(txt) as Record<string, string>;
}

// generatePairings associates one user with another and writes those to file.
async function generatePairings() {
	// get all users
	const u = (await app.getUsers()).map( u => u.proxyId );
	const num = u.length;

	// shuffle the array of user identifiers using Fisher Yates:
	// See: https://javascript.info/task/shuffle
	for (let i = num-1; i > 0; i--) {
		let j = Math.floor(Math.random() * (i + 1));
		[u[i], u[j]] = [u[j], u[i]];
	}

	// Pair each user with the one preceding it:
	const pairs :Record<string,string> = {};
	pairs[u[0]] = u[num -1];
	for( let i=1; i<num; ++i) {
		pairs[u[i]] = u[i-1];
	}
	
	//write it out:
	await Deno.writeTextFile(getPairingsFile(), JSON.stringify(pairs));
}

// home is the main page renderer
async function home(ctx:Context) {
	if( !ctx.proxyId ) throw new Error("Expected an authenticated user");

	if( await generated() ) {
		const user = await app.getUser(ctx.proxyId);
		const pairings = await readPairings();
		const pairee = await app.getUser(pairings[ctx.proxyId]);
		const html = await renderFile(app.appPath('templates/your-pairing.html'), {
			user,
			pairee
		});
		ctx.respondHtml(html); 
	}
	else {
		const users = await app.getUsers();
		const html = await renderFile(app.appPath('templates/generate-form.html'), {
			users,
			too_few: users.length <=2
		});
		ctx.respondHtml(html); 
	}
}
// generatehandler is called to trigger the generation of pairs
async function generateHandler(ctx:Context) {
	let msg = '';
	if( await generated() )	msg = "Already generated";
	
	const users = await app.getUsers();
	if( users.length <=2 ) msg = "Not enough people to generate a secret santa list!"

	if( !msg ) {
		await generatePairings();
		msg = "Created Secret Santa List!"
	}

	const html = await renderFile(
		app.appPath('templates/generate-error.html'), 
		{msg});
	ctx.respondHtml(html);
}

const auth = {allow:AuthAllow.authorized};
const r = new RoutesBuilder;
r.add("get", "/", auth, home);
r.add("post", "/generate-pairings", auth, generateHandler);
r.add("get", {path:"/avatars", end: false}, auth, r.staticFileHandler({path:'@avatars/'}));
r.add("get", {path:"/static", end: false}, auth, r.staticFileHandler({path:'@app/static/'}));

const app = createApp({
	routes: r.routes,
	migrations: m.migrations
});