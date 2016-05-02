var mysql = require('mysql'),
    crypto = require('crypto'),
    uuid = require('node-uuid'),
    fstools = require('fs-tools'),       //파일이동 관련 npm
    ffmpeg = require('fluent-ffmpeg'),
    async = require('async'),
    easyimage = require('easyimage'),   //thunbnail 만들어주는 npm;
    util = require('util'),
    path = require('path'),
    queues = require('mysql-queues'),
    winston = require('winston');

var serverUrl = "192.241.222.231";

function format(name, req, res) {
    //:remote-addr - - [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"
    req._startTime = new Date();
    var remoteAddr = req.socket &&
        req.socket.remoteAddress || (req.socket.socket && req.socket.socket.remoteAddress);
    var date = new Date().toUTCString();
    var method = req.method;
    var url = req.originalUrl || req.url;
    var httpVersion = 'HTTP/' + req.httpVersionMajor + '.' + req.httpVersionMinor;
    var status = res.statusCode;
    var resContentLength = parseInt(res.getHeader('Content-Length'), 10) || '-';
    var referrer = req.headers['referer'] || req.headers['referrer'] || '-';
    var userAgent = req.headers['user-agent'];

    var info = remoteAddr + ' - - [' + date + '] "' + method + ' ' + url + ' ' +
        httpVersion + '" ' + status + ' "' + referrer + '" ' + resContentLength +
        ' - ' + (new Date() - req._startTime) + 'ms "' + userAgent + '"';
    var debug = util.format('query: %j\nbody: %j\nfiles: %j\nparams: %j\n', req.query, req.body, req.files, req.params);

    if (name === 'dev') {
        return info + '\n' + debug;
    } else {
        return info;
    }
}

var logger = new winston.Logger({
    transports: [
        new winston.transports.Console({level: 'debug', timestamp: false}),
        new winston.transports.File({
            level: 'debug',
            filename: './logs/winston_application.log',
            timestamp: false,
            maxsize: 1 * 1024 * 1024,
            json: false
        })
    ],
    exceptionHandlers: [
        new winston.transports.File({
            filename: './logs/winston_exception.log',
            maxsize: 1 * 1024,
            json: false
        })
    ]
});

var pool = mysql.createPool({
    host: 'localhost',
    port: '3306',
    user: 'root',
    password: 'rhwkdtns',
    database: 'Furkid',
    waitForConnections: true,
    connectionLimit: 50
});

// 로그인
exports.login = function (req, res) {
    logger.info(format('dev', req, res));
    var email = req.body.email; // 사용자가 로그인할때 ID로사용하는 email
    var passwd = req.body.passwd; // 사용자가 로그인 할때 비밀번호로 사용하는 passwd
    pool.getConnection(function (err, connection) { // DB연결을 pool 에서 가져온다
        if (err) {   //DB 연결 실패시 callback 함수호출 에러처리
            if (connection !== undefined) {
                connection.end();
            }
            console.log("Connection Error");
            res.jsonp({"Error": "Connection Error"});
            return;
        }

        // 사용자의 정보를 저장해서 response 로 보내주기 위한 객체
        var user_info = {
            "my_id": null,
            "nickname": null,
            "authkey": null,
            "pet_info": []
        };
        // 로그인 하면 클라이언트가 user_id, nickname, authkey, pet 의 정보등을 가지고 있게 하기위한 코드
        connection.query('select id, nickname ' +
            '  from user ' +
            ' where email = ? and passwd = ?', [email, passwd], function (err, my_info) {
                if (err) {    //select 에러처리
                    connection.end(function () {
                        console.log("Select Error - login");
                        res.jsonp({"Error": "Select Error - login"});
                    });
                    return;
                }
                if (my_info.length > 0) { // 로그인이 되었을 때 실행
                    if (!req.cookies.authkey) { // 로그인을 한적이 없을때 authkey 를 생성
                        var authkey = uuid.v1();
                        res.cookie('authkey', authkey, { // authkey 의 수명을 1년으로 설정
                            maxAge: 365 * 30 * 24 * 60 * 60 * 1000
                        });
                        // 사용자가 소유하고 있는 동물의 정보를 보여주기 위한 코드
                        connection.query('select id, pet_name, pet_photo_path ' +
                            '  from pet ' +
                            ' where user_id = ? ', [my_info[0].id], function (err, pet_infos) {
                            if (err) {//////////////////////////select Error코드
                                connection.end(function () {
                                    console.log("Pet select failed");
                                    res.jsonp({"Error": "Select Error - login"});
                                });
                                return;
                            }
                            if (pet_infos.length > 0) { //select 한 동물의 정보가 있을 경우
                                // select 한 사용자,동물의 정보를 객체에 입력
                                user_info.my_id = my_info[0].id; // id
                                user_info.nickname = my_info[0].nickname; // nickname
                                user_info.authkey = authkey; // authkey
                                user_info.pet_info = pet_infos; // pet_info
                                // 생성한 사용자의 authkey를 user table의 authkey에 입력
                                connection.query('update user set authkey = ? ' +
                                    ' where email = ? ', [authkey, email], function (err, result) {
                                    if (err) {    //update 에러처리
                                        connection.end(function () {
                                            res.jsonp({"Error": "Update failed - login"});
                                            return;
                                        });

                                    }
                                    connection.end(function () {// 데이터베이스 연결 반납
                                        console.log('Login Success!!');
                                        res.jsonp({"user_info": user_info}); // 위에서 생성한 user 정보를 json 객체로 response 한다
                                    });
                                });
                            } else {  //select한 동물의 정보가 없을 경우
                                connection.end(function () {
                                    res.jsonp({"message": "You don't have pet"});
                                });
                            }
                        });
                    } else { // 이미 로그인을 한 상태일때 JSON 객체로 message 전송,DB 연결 반납
                        connection.query('select u.id as user_id, u.nickname as user_nickname, p.id as pet_id, p.pet_name as pet_name, p.pet_photo_path as pet_photo_path ' +
                            '  from pet p join user u on u.id = p.user_id ' +
                            ' where u.id = ? ', [my_info[0].id], function (err, infos) {
                            if (err) {//////////////////////////select Error코드
                                connection.end(function () {
                                    res.jsonp({"Error": "Select Error - login"});
                                });
                                return;
                            }
                            if (infos.length === 0) {
                                connection.end(function () {
                                    res.jsonp({"message": "No one select user, pet infomation"});
                                });
                            } else {
                                user_info.my_id = infos[0].user_id;
                                user_info.nickname = infos[0].user_nickname;
                                infos.forEach(function (info, idx, array) {
                                    user_info.pet_info[idx].pet_id = info.pet_id;
                                    user_info.pet_info[idx].pet_name = info.pet_name;
                                    user_info.pet_info[idx].pet_photo_path = info.pet_photo_path;
                                    if (idx === (array.length - 1)) {
                                        connection.end(function () {
                                            res.jsonp({"user_info": user_info});
                                        });
                                    }
                                });
                            }
                        });
                    }
                } else { // 로그인 실패시 JSON 객체로 message 전송, DB 연결 반납
                    connection.end(function () {
                        res.jsonp({"message": "wrong data"});
                    });
                }
            }
        );
    });
};

