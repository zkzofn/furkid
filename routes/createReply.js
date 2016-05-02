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


//댓글 생성
exports.createReply = function (req, res) {
    logger.info(format('dev', req, res));
    pool.getConnection(function (err, connection) {

        console.log('데이터베이스 연결합니다.');

        var timeline_id = req.body.timeline_id;			//댓글을 게시할 글의 ID
        var pet_id = req.body.pet_id;					      //댓글을 게시할 동물의 ID
        var re_content = req.body.re_content;			  //글의 본문내용

        //pet_id 를 이용해서 동물의 이름과 사진URL을 가져온다
        connection.query('select pet_name, pet_photo_path ' +
            '  from pet ' +
            'where id = ? ', [pet_id], function (err, pet_info) {
            if (err) {
                connection.end(function () {
                    console.log("Fail in select pet_info");
                    res.jsonp({"Error": "Fail in select pet_info"});
                });
            }
            //댓글의 정보를 입력
            connection.query('insert into reply (timeline_id, pet_id, pet_name, pet_photo_path, re_content, re_date) ' +
                'values (?,?,?,?,?,now()) ', [timeline_id, pet_id, pet_info[0].pet_name, pet_info[0].pet_photo_path, re_content],
                function (err, result) {
                    if (err) {
                        connection.end(function () {
                            console.log("Fail in insert into reply");
                            res.jsonp({"Error": "Fail in insert into reply"});
                        });
                    }
                    connection.end(function () {
                        console.log("reply create success!!");
                        res.jsonp({"message": "reply create success"});
                    });
                });
        });
    });
};
