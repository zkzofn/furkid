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


// 회원가입
exports.signup = function (req, res) {
    logger.info(format('dev', req, res));
    pool.getConnection(function (err, connection) { // DB연결을 pool 에서 가져온다
        if (err) {   //DB 연결 실패시 callback 함수호출 에러처리
            if (connection !== undefined) {
                connection.end();
            }
            console.log("Connection Error");
            res.jsonp({"Error": "Connection Error"});
            return;
        }

        var email = req.body.email; // 로그인할때 사용할 email 정보
        var passwd = req.body.passwd; // 로그인할때 사용할 passwd 정보
        var nickname = req.body.nickname; // 홈 화면에서 보여주기 위한 nickname 정보

        // email 중복을 검사하는 코드
        connection.query('select email from user where email= ?', [email], function (err, result) {
            if (err) {    //select Error
                connection.end(function () {
                    console.log("Select Error");
                    res.jsonp({"Error": "Select Error"});
                    return;
                });
            }
            if (result.length > 0) { // 중복되는 경우에 DB 연결 종료, JSON 객체로 Error 전송
                connection.end(function () {
                    res.jsonp({'error': 'email duplicated'});
                });
            } else { // 중복되지 않는 경우에 user table 에 email, passwd, nickname,
                // 등록날짜 입력
                connection.query('insert into user (email , passwd , nickname , reg_date) values (?,?,?,now())',
                    [email, passwd, nickname], function (err, result) {
                        if (err) {    // insert 에서 error발생시 DB 연결 종료
                            connection.end(function () {  //JSON 객체로 Error 전송
                                res.jsonp({"error": "insert error"});
                            });
                        }
                        connection.end(function () { //정상적으로 insert 되었을때 DB연결 종료, JSON 객체로 메세지 전송
                            res.jsonp({"message": "success"});
                        });
                    });
            }
        });
    });
};