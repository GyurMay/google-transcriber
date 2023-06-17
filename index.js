const https = require('https');
const http = require("http");
const fs = require('fs');
const cc = require('./client_credentials.json');
const querystring = require('querystring');
const url = require('url');
const crypto = require("crypto");
const formidable = require("formidable");
const server = http.createServer(req_handler);
const port = 3000;

const api_Key =  `AIzaSyDzjsQodu7iZl-6BEZFBSZokSPJkO8Trfs`;

let headers = cc.web;
const {client_id, client_secret, auth_uri, redirect_uri} = headers;
const response_type="code";

// const scope = ["https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.metadata https://www.googleapis.com/auth/drive.photos.readonly"];
const scope = ['https://www.googleapis.com/auth/drive'];
const cache_fileName = './authentication-res.json';

const sessions = [];

server.on("listening", listen_handler);
server.listen(port);
function req_handler(req, res){
    if(req.url === "/"){
        let home = fs.createReadStream("index.html");
        res.writeHead(200, {'Content-Type': 'text/html'});
        home.pipe(res);
    }
    else if(req.url === "/save_transcript"){
        let form = new formidable.IncomingForm();

        form.parse(req, (err, fields, file) => {
            if (err) {
                console.error(err.message);
                return;
            }
            let oldPath = file.audioFile.filepath;
            let newPath = __dirname + "\\" + file.audioFile.originalFilename;
            console.log(oldPath,'\n',newPath)
            fs.rename(oldPath, newPath, () => {
                /** file Uploaded **/
                let {client_token} = cc.wit;//client
                let wit_uri = `https://api.wit.ai/speech`;
                let audioFile = fs.createReadStream(newPath);
                let buffAry = [];
                audioFile.on('data', (ch) => buffAry.push(ch));
                audioFile.on('end', () => {
                    let options = 
                    { 
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${client_token}`,
                            'Content-Type': `audio/mpeg3`
                        }
                    };
                    let buffer = Buffer.concat(buffAry); 
                    https.request(wit_uri, options , (strm) => process_stream(strm, get_transcript, res)).end(buffer);
                });
                
            });
        });
    }
    else if(req.url.startsWith("/getCode")){
        let myurl = url.parse(req.url, true).query;
        let {code, scope, state} = myurl;
        let tt = sessions.find(session => session.state === state);
        send_token_request(res, tt.text_transcript, code);
    }
    else{
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.end("<body style='display:grid; background:#000; place-items:center'><img src='https://http.cat/404'></body>");
    }
}
function send_token_request(res, text_transcript, code){
    const {token_uri} = headers;
    let options = {
        method: "POST",
        header: {
            "Content-Type":"application/x-www-form-urlencoded"
            }
    }
    let post_data = {
        grant_type: "authorization_code",
        "code": code,
        client_id,
        client_secret,
        redirect_uri: "http://localhost:3000/getCode"
    };
    https.request(token_uri, options, (tkn_stream) => process_stream(tkn_stream, receive_access_token, text_transcript, res))
    .end(JSON.stringify(post_data));
}
function process_stream(strm, callback, ...args){
    let body = '';
    //strm.on('error'
    // a = 0;
    strm.on('data', ch =>{
        /* if(a == 0){
             console.log(ch+'\n----DONEDONEDONE'); a++;
         } */
        body += ch;
    });
    strm.on('end', () => callback(body, ...args));
}
function receive_access_token(body, text_transcript, res){
    let token_body = JSON.parse(body);
    let {access_token} = token_body;
    
    cache_token(token_body);
    create_file(access_token, text_transcript, res);
}
function cache_token(token_body){
    token_body.expiration = new Date((new Date()).getTime() + token_body.expires_in * 1000);
    fs.writeFileSync(cache_fileName, JSON.stringify(token_body), (s)=>{s.on('error', c => console.log('')) });
}
function get_transcript(body, res){
    body = `{"entities": {}, "intents":[], "is_final${body.split('is_final')[1]}`;
    // console.log(body.split('is_final')[1]) 
    // {"entities": {}, "intents":[], "is_final ": true, 
    // console.log(body)
    // return
    let response = JSON.parse(body);
    console.log(response, "response")
    if(response.text == ""){
        res.end("Wit couldn't hear anything transcribale.. Try again");
    }else{
        let text_transcript = response.text;
        let state = crypto.randomBytes(20).toString("hex");
        sessions.push({text_transcript, state});
        // fs.writeFileSync('sessions.json', JSON.stringify(sessions), () => {});

        console.log(`text_transcript from wit get_transcript: ${text_transcript}`);
        
        //cache block
        let cached = false;
        let current_tkn_obj = [];
        if(fs.existsSync(cache_fileName)){
            current_tkn_obj = require(cache_fileName);  
            let date = new Date();
            if(current_tkn_obj.expiration !== undefined && date.getTime() < new Date(current_tkn_obj.expiration).getTime()){
                cached = true;
            }
        }
        if(cached){
            console.log(`found cached token`);
            let id = {};
            create_file(current_tkn_obj.access_token, text_transcript, res);
        }else{
            let uri = querystring.stringify({response_type, client_id, redirect_uri, scope, state})
            res.writeHead(302, {'Location': auth_uri+'?'+uri});
            res.end();
        }
    }
}
function create_file(access_token, text_transcript, res){
    let options = {
        method: 'POST',
        headers : {
            Authorization:`Bearer ${access_token}`,
            Accept : 'application/json',
            'Content-Type': 'text/plain'
        }
    };
    let def_title = `WIT Transcript ` + (new Date()).toLocaleString('en-US', { timeZone: 'America/New_York' });
    let newName = def_title;
    let endpoint = `https://www.googleapis.com/upload/drive/v3/files?uploadType=media`;

    text_transcript =
    `
    Transcription from wit.ai\n
    ${text_transcript}
    `;

    https.request(endpoint, options, (str) => process_stream(str, file_created, newName, access_token, res))
    .end(text_transcript);
}
function file_created(body, newName, access_token, res){
    let jBod = JSON.parse(body);
    console.log(JSON.parse(body));

    rename_file(jBod.id, newName, access_token, res);
}
function rename_file(id, newName, access_token, res){
    let pd = {
        name: newName,
        mimeType: "application/vnd.google-apps.document"
    }
    https.request(`https://www.googleapis.com/drive/v3/files/${id}`, {
        method: "PATCH",
        headers: {
            Authorization:`Bearer ${access_token}`,
            'Content-Type' : 'application/json'
        }
    }, (strm) => {
        let body = '';
        strm.on('data', ch => body += ch);
        strm.on("error", x => console.log(x))
        strm.on('end', () => { 
            fs.readdir('./', (err, files) => { // cleaning up - deleting files.
                files.forEach((file) => {
                    if(file.endsWith(".mp3")) fs.rm(file, (s)=>{console.log("deleted the file", s)});
                });
            })
            res.writeHead(200, {'Content-Type':'text/html'});
            res.end(`
                <h1>Uploaded transcript successfully to Google Docs! by name ${newName}</h1>`)
        });

    })
    .end(JSON.stringify(pd));
}

function listen_handler(){
    console.log("listening at port: "+port)
}