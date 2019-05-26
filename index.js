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

let token;
let names;
let usergroups;
let ids;
let resolve;

let messages = {};


bot.on("start", async () => {
    console.log("Bot is now running");
    //send_autodelete_message("GJH7TRYTA", "This message will be deleted in 5 seconds.", 5000);
});

bot.on("message", async (message) => {
    if(!message.type || message.type != "message" || message.subtype == "bot_message" || message.subtype == "message_deleted") return;
    console.log(message);
    if(message.text == "!rb") {
        await send_autodelete_message(message.channel, `Allow the bot to manage user groups by clicking <${oauth_redirect()}|here>.\n\nThis message will be deleted in 1 minute.`, 1000 * 45)
        const code = await get_oauth_code();
        token = await exchange_oauth_code(code);
        usergroups = (await fetch_user_groups(token)).usergroups;
        names = usergroups.map((group) => {return group.name;});
        ids = usergroups.map((group) => {return group.id;});
        await send_autodelete_message(message.channel, `Success! You can now configure the reaction message with the following format:\n !rb <usergroup name>%<reaction> <usergroup name>%<reaction>...\n\nThis message will be deleted in 1 minute.`, 1000 * 45);
    } else if(message.text.startsWith("!rb")) {
        if(!usergroups) return;
        try {
            message.text = message.text.substring(4);
            const tokens = message.text.split(" ");

            let messageText = "*React to get roles associated with your subteam:*";
            let reactions = [];
            let bad = false;
            const reactNameMap = {};
            tokens.some((token) => {
                const name = token.split("%")[0];
                const react = token.split("%")[1];

                const ind = names.indexOf(name);
                if(ind == -1) {
                    bad = true;
                    return true;
                }
                messageText += `\n${name}: ${react}`
                reactions.push(react);
                reactNameMap[react.substring(1, react.length - 1)] = name;
                return false;
            });
            if(bad) {
                await send_autodelete_message(message.channel, `Invalid usergroup name:`, 1000 * 30);
                return;
            }
            const sent_message = (await api("POST", "chat.postMessage", {
                token: config.token,
                channel: message.channel,
                text: messageText
            })).message;
            for(let i = 0;i < reactions.length;i ++) {
                const reaction = reactions[i];
                await api("POST", "reactions.add", {
                    token: config.token,
                    name: reaction.substring(1, reaction.length - 1),
                    channel: message.channel,
                    timestamp: sent_message.ts
                });
            }
            messages[sent_message.ts] = {
                usergroups: usergroups,
                ids: ids,
                names: names,
                reactNameMap: reactNameMap
            }

        } catch(e) {
            console.log(e);
            await send_autodelete_message(message.channel, `Invalid command format.`, 1000 * 30);
        }
    }
})

/**
 * Sends a request to the slack API and retrieves the result/error
 * @param {string} method the http request method (e.g. GET, POST)
 * @param {string} endpoint the api method to call (e.g. user.info)
 * @param {object} params the parameters to send to the server. they will automatically be sent as 
 *                        url parameters or in the post body depending on the request type
 */
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
            params: params
        }
    }
    console.log(endpoint);
    const resp = await axios({
        method: method,
        url: url,
        ...payload
    });
    console.log(resp.data);
    return resp.data;
}

const send_autodelete_message = async (channel, text, timeout) => {
    const message = (await api("POST", "chat.postMessage", {
        token: config.token,
        channel: channel,
        text: text
    })).message;
    setTimeout(() => {
        api("POST", "chat.delete", {
            token: config.token,
            channel: channel,
            ts: message.ts
        })
    }, timeout);
}

const oauth_redirect = () => {
    return `https://slack.com/oauth/authorize?client_id=${config.client_id}&scope=usergroups:read usergroups:write&redirect_uri=${config.base_url}/oauth&team=${config.team_id}`;
}

const get_oauth_code = async () => {
    return new Promise((res, reject) => {
        resolve = res;
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

const fetch_user_groups = async (token) => {
    return await api("GET", "usergroups.list", {
        token: token
    });
}

const get_users_in_usergroup = async (token, usergroup) => {
    return (await api("GET", "usergroups.users.list", {
        token: token,
        usergroup: usergroup
    })).users;
}

const update_usergroup = async (token, id, users) => {
   api("POST", "usergroups.users.update", {
        token: token,
        usergroup: id,
        users: users.join(",")
    })
}

/**
 * The serve accomplishes 3 tasks at once:
 * 1) keep the glitch process alive by exposing an endpoint and pinging it
 * 2) listen for oauth authorizations to obtain user codes
 * 3) listen for reaction events and adjust user groups
 */
http.createServer(async (req, res) => {
    const url = urllib.parse(req.url, true);
    if(url.pathname == "/") {
        res.writeHead(200, {"Content-Type": "text/plain"});
        res.end("Bot is running.")
    }
    else if(url.pathname == "/event" && req.method == "POST") { 
        let body = "";
        req.on("data", chunk => {body += chunk.toString()});
        req.on("end", async () => {
            const data = JSON.parse(body);
            res.writeHead(200, {"Content-Type": "text/plain"});
            if(data.event.type == "url_verification") {
                res.end(data.challenge);
            }
            res.end("Thanks!");
            if(data.event.user == config.bot_id) return;
            if(data.event.type == "reaction_added") {
                if(!messages[data.event.item.ts]) return;
                const info = messages[data.event.item.ts];
                const userGroupId = ids[names.indexOf(info.reactNameMap[data.event.reaction])];
                const users = await get_users_in_usergroup(token, userGroupId);
                if(users.indexOf(data.event.user) == -1) {
                    users.push(data.event.user);
                    update_usergroup(token, userGroupId, users);
                }
            }
            else if(data.event.type == "reaction_removed") {
                if(!messages[data.event.item.ts]) return;
                const info = messages[data.event.item.ts];
                const userGroupId = ids[names.indexOf(info.reactNameMap[data.event.reaction])];
                const users = await get_users_in_usergroup(token, userGroupId);
                if(users.indexOf(data.event.user) >= 0) {
                    users.splice(users.indexOf(data.event.user), 1);
                    update_usergroup(token, userGroupId, users);
                }
            }
        });
    }
    else if(url.pathname == "/oauth" && resolve) {
        resolve(url.query["code"]);
        resolve = undefined;
        res.writeHead(200, {"Content-Type": "text/plain"});
        res.end("Successfully authorized. You may now close this page.");
    } else {
        res.writeHead(404, {"Content-Type": "text/plain"});
        res.end("Not found");
    }
}).listen(process.env.PORT || 5000);



// (async function() {
//     const code = await get_oauth_code();
//     console.log(code);
//     const token = await exchange_oauth_code(code);
//     console.log(token);
//     console.log(await api("GET", "usergroups.list", {
//         token: token
//     }));
// })();