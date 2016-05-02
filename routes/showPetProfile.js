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








//동물의 프로필과 그 동물이 게시한 글을 보여줌
exports.showPetProfile = function (req, res) {
    logger.info(format('dev', req, res));
    async.waterfall([
        function (callback) {
            console.log('async.waterfall #1');
            var my_id = req.query.my_id;
            var page_cnt = (req.query.page_cnt - 1) * 10;
            var timelines = [];
            var pet_id = req.params.pet_id;
            pool.getConnection(function (err, connection) {
                if (err) {
                    if (connection !== undefined) {
                        connection.end();
                    }
                    callback(err);
                }
                //해당 동물이 쓴 글들을 가져온다
                connection.query('select id, wr_date, user_id, wr_category, like_cnt, wr_content, pet_id, pet_name, pet_photo_path, wr_video_path, wr_video_thumb_path ' +
                    '  from timeline ' +
                    ' where pet_id = ? ' +
                    ' order by wr_date desc ' +
                    ' limit ?, 10 ', [pet_id, page_cnt], function (err, rows) {
                    if (rows.length == 0) {
                        console.log('글이없어!!');
                        timelines = null;
                        callback(null, connection, timelines, pet_id);
                    } else {
                        //각 글별로 좋아요 유무를 확인한다
                        rows.forEach(function (row, idx, array) {
                            connection.query('select timeline_id ' +
                                '  from like_timeline ' +
                                ' where user_id=? and timeline_id=?',
                                [my_id, row.id], function (err, result) {
                                    if (err) {
                                        connection.end(function () {
                                            callback("좋아요 select 실패", null);
                                            console.log("좋아요 select 실패");
                                        });
                                    } else {
                                        var like_yes_no
                                        if (result.length > 0) {
                                            like_yes_no = true;
                                        } else {
                                            like_yes_no = false;
                                        }
                                        var timeline = {//각 글에 표시되는 정보
                                            "id": row.id, //각 글의 고유 ID
                                            "wr_date": row.wr_date, //글을 게시한 시간
                                            "user_id": row.user_id, //글을 게시한 사용자의 ID
                                            "wr_category": row.wr_category, //글의 카테고리
                                            "like_cnt": row.like_cnt, //글이 좋아요를 받은 수
                                            "wr_content": row.wr_content, //글의 본문내용
                                            "pet_id": row.pet_id, //글을 게시한 동물의 고유 ID
                                            "pet_name": row.pet_name, //동물의 이름
                                            "pet_photo_path": row.pet_photo_path, //동물의 프로필 사진의 URL
                                            "wr_video_path": row.wr_video_path, //게시된 동영상의 URL
                                            "wr_video_thumb_path": row.wr_video_thumb_path, //동영상의 썸네일 URL
                                            "like_yes_no": like_yes_no, //my_id의 사용자가 글을 좋아요 눌렀는지 여부
                                            "reply": []  //각 글의 댓글을 저장하는 배열
                                        };
                                        timelines[idx] = timeline;
                                        if (idx === (array.length - 1))   //마지막 글일때 callback함수 호출
                                            callback(null, connection, timelines, pet_id);
                                    }
                                });
                        });
                    }
                });
            });
        },

        function (connection, timelines, pet_id, callback) {
            console.log('async.waterfall #2');
            if (timelines === null) {
                callback(null, connection, timelines, pet_id);
            } else {
                // 댓글을 timelines의 원소의 reply 속성에 추가합니다.
                timelines.forEach(function (timeline, idx) {
                    connection.query('select id, pet_id, re_date, re_content, pet_name, pet_photo_path' +
                        '  from reply ' +
                        ' where timeline_id = ? ' +
                        ' order by re_date', [timeline.id], function (err, replies) {
                        if (replies.length > 0) {
                            timeline.reply = replies;
                        }
                    });

                    if (idx === (timelines.length - 1)) {
                        callback(null, connection, timelines, pet_id);
                    }
                });
            }
        },

        function (connection, timelines, pet_id, callback) {
            console.log('async.waterfall #3');

            //새로운 객체를 만들어서 pet의 정보와 해당 타임라인을 보여줍니다.
            var pet_page = {
                "timelines": [],
                "pet_info": {}
            };
            pet_page.timelines = timelines;
            //동물을 프로필을 가져온다
            connection.query('select id, user_id, pet_name, birth, pet_speciality, pet_region, pet_photo_path, sex, pet_like, pet_hate, pet_love' +
                '  from pet ' +
                ' where id = ? ', [pet_id], function (err, pet_info) {
                if (err) {
                    console.log("동물의 프로필가져오기 실패");
                    callback(err);
                } else {    //가져온 결과를 pet_page의 pet_info에 저장
                    pet_page.pet_info = pet_info[0];
                    connection.end();
                    callback(null, pet_page);
                }
            });

        }], function (err, pet_page) {
        if (err) {
            console.log(err);
            res.jsonp(err);
        } else {
            console.log("Show pet profile Success");
            res.jsonp({"pet_page": pet_page});
        }


    });
};
