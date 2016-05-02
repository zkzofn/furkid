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




exports.showFriendsList = function (req, res) {
    logger.info(format('dev', req, res));
    var my_id = req.params.my_id;
    var friendsList = [];

    //동물사진이랑 사용자 닉네임으로 출력해줌
    pool.getConnection(function (err, connection) {    //pool 에서 DB접속을 가져옵니다.

        //접속한 사용자의 친구들의 닉네임와 ID를 가져온다
        connection.query('select u.nickname as nickname, u.id as id ' +
            '  from friend f join user u on f.r_user_id = u.id ' +
            ' where f.s_user_id = ? and f.friend_check = 1' +
            ' order by u.nickname ', [my_id], function (err, rows) {
            rows.forEach(function (row, idx, array) {
                //각 사용자별로 동물의 사진을 가져온다
                connection.query('select pet_photo_path ' +
                    '  from pet ' +
                    ' where user_id = ? ', [row.id], function (err, result) {

                    var friend = {
                        "nickname": null,
                        "user_id": null,
                        "pet_photos": []
                    };
                    console.log(util.inspect(row.id));
                    friend.nickname = row.nickname;
                    friend.user_id = row.id;
                    friend.pet_photo = result;

                    friendsList[idx] = friend;
                    if (idx === (array.length - 1)) {
                        connection.end();
                        console.log("사용자 리스트 출력");
                        res.jsonp({"friendsList": friendsList});
                    }
                });
            });
        });
    });
};
