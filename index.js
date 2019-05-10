const fs = require("fs");
const config = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
const SlackBot = require("slackbots");
const axios = require("axios");
const http = require("http");
const urllib = require("url");

const bot = new SlackBot({
    token: config.token,
    name: config.name
});

let channels;
const yes = false;

bot.on("start", async () => {
    console.log("Bot is now running");

    if(yes)console.log(await api("POST", "chat.postMessage", {
        channel: "GJH7TRYTA",
        text: `Authorize your request <${oauth_redirect()}|here>`,
        token: config.token
    }));
});
console.log(config.token);

const api = async (method, endpoint, params) => {
    const url = "https://slack.com/api/" + endpoint;
    if(!params) params = {};
    let payload;   
    if(method ==  "GET") {
        payload = {
            params: params
        }
    } else {
        payload = {
            data: params
        }
    }
    const resp = await axios({
        method: method,
        url: url,
        ...payload
    });
    //console.log(endpoint);
    //console.log(resp.data);
    return resp.data;
}

const oauth_redirect = () => {
    return `https://slack.com/oauth/authorize?client_id=${config.client_id}&scope=usergroups:read usergroups:write&redirect_uri=${config.base_url}/oauth&team=${config.team_id}`;
}

const get_oauth_code = async () => {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = urllib.parse(req.url, true);
            if(url.pathname != "/oauth") {
                res.writeHead(404, {"Content-Type": "text/plain"});
                res.end("Not found");
                reject();
                return;
            }
            resolve(url.query["code"]);
            res.writeHead(200, {"Content-Type": "text/plain"});
            res.end();
            server.close();
        }).listen(8000);
    });
}

const exchange_oauth_code = async (code) => {
    return (await api("GET", "oauth.access", {
        client_id: config.client_id,
        client_secret: config.client_secret,
        code: code,
        redirect_uri: config.base_url + "/oauth"
    })).access_token;
}

(async function() {
    const code = await get_oauth_code();
    console.log(code);
    const token = await exchange_oauth_code(code);
    console.log(token);
    console.log(await api("GET", "usergroups.list", {
        token: token
    }));
})();