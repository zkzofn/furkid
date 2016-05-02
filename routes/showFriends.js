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


// 사용자의 친구들이 쓴 글을 보여준다
exports.showFriends = function (req, res) {
    logger.info(format('dev', req, res));
    async.waterfall(
        [
            function (callback) { // waterfall 시작
                console.log('async.waterfall #1');

                var my_id = req.params.my_id;
                var page_cnt = (req.query.page_cnt - 1) * 10;
                var timelines = [];

                console.log("my_id1111 : " + my_id);

                pool.getConnection(function (err, connection) { // DB 연결을 pool 에서 가져옵니다
                    if (err) {
                        connection.end(function () {
                            console.log("pool에서 connection 을 가져오지 못했습니다");
                            callback("pool에서 connection 을 가져오지 못했습니다");
                        });
                    }
                    // 사용자의 친구 목록을 불러오는 코드
                    connection.query('select s_user_id, r_user_id ' +
                        '  from friend ' +
                        ' where s_user_id = ? and friend_check = 1 ', [my_id], function (err, result) {
                        if (err) {
                            connection.end(function () {
                                console.log("my_id 유저의 친구 목록 불러오기 실패");
                                callback("my_id 유저의 친구 목록 불러오기 실패");
                            });
                        }
                        if (result.length === 0) { // 해당 사용자의 친구가 없을 때
                            connection.end(function () {
                                res.jsonp({
                                    "message": "친구가 없습니다 친구를 맺어주세요",
                                    "timelines": null
                                });
                                console.log("You don't have friends");
                            });
                        } else { // 해당 사용자의 친구가 있을 때
                            // 사용자의 친구들의 글을 불러온다
                            connection.query('select t.id, t.wr_date, t.user_id, t.wr_category, t.like_cnt, t.wr_content, t.pet_id, t.pet_name, t.pet_photo_path, t.wr_video_path, t.wr_video_thumb_path ' +
                                '  from timeline t join friend f on t.user_id = f.r_user_id ' +
                                ' where f.s_user_id = ? and f.friend_check = 1 ' +
                                ' order by t.wr_date desc ' +
                                ' limit ?, 10', [my_id, page_cnt], function (err, rows) {
                                if (err) {
                                    connection.end(function () {
                                        console.log("친구들의 글을 불러오기 실패");
                                        callback("친구들의 글을 불러오기 실패");
                                    });
                                }
                                if (rows.length === 0) {
                                    connection.end(function () {
                                        console.log("친구들이 쓴 글이 없습니다.");
                                        res.jsonp({
                                            "message": "친구들이 쓴 글이 없습니다.",
                                            "timelines": null
                                        });
                                    });
                                } else {
                                    // 사용자가 각 글에 대해 좋아요 여부를 검사하기 위한 코드
                                    rows.forEach(function (row, idx, array) {
                                        connection.query('select timeline_id ' +
                                            '  from like_timeline ' +
                                            ' where user_id=? and timeline_id=?', [my_id, row.id], function (err, result) {
                                            if (err) {
                                                connection.end(function () {
                                                    console.log("사용자의 좋아요 여부 체크하다가 에러");
                                                    callback("사용자의 좋아요 여부 체크하다가 에러");
                                                });
                                            }

                                            var like_yes_no;
                                            if (result.length > 0) {
                                                like_yes_no = true;
                                            } else {
                                                like_yes_no = false;
                                            }
                                            var timeline = { // 각 글에표시되는정보
                                                "id": row.id, // 각 글의고유ID
                                                "wr_date": row.wr_date, // 글을게시한시간
                                                "user_id": row.user_id, // 글을게시한사용자의ID
                                                "wr_category": row.wr_category, // 글의카테고리
                                                "like_cnt": row.like_cnt, // 글이좋아요를받은 수
                                                "wr_content": row.wr_content, // 글의본문내용
                                                "pet_id": row.pet_id, // 글을게시한동물의고유ID
                                                "pet_name": row.pet_name, // 동물의이름
                                                "pet_photo_path": row.pet_photo_path, // 동물의프로필사진의URL
                                                "wr_video_path": row.wr_video_path, // 게시된동영상의URL
                                                "wr_video_thumb_path": row.wr_video_thumb_path, //동영상의 썸네일 URL
                                                "like_yes_no": like_yes_no, //my_id의 사용자가 글을 좋아요 눌렀는지 여부
                                                "reply": []//각 글의 댓글을 저장하는 배열
                                            };
                                            timelines[idx] = timeline;
                                            if (idx === (array.length - 1)) //마지막 게시글에서 callback 함수 호출
                                                callback(null, connection, timelines);
                                        });
                                    });
                                }
                            });
                        }
                    });
                });
            },

            function (connection, timelines, callback) {
                console.log('async.waterfall #2');
                // 댓글을 timelines의 원소의 reply 속성에 추가합니다.
                timelines.forEach(function (timeline, idx) {
                    connection.query('select id, pet_id, re_date, re_content, pet_name, pet_photo_path' +
                        '  from reply ' + ' where timeline_id = ? ' +
                        ' order by re_date', [timeline.id], function (err, replies) {
                        if (err) {
                            connection.end(function () {
                                console.log("댓글 보여주다가 에러");
                                callback("댓글 보여주다가 에러");
                            });
                        }
                        if (replies.length > 0) { //댓글이 있을 경우
                            timelines[idx].reply = replies; //timelines 의 배열에 저장
                            if (idx === (timelines.length - 1)) {
                                connection.end();
                                console.log("마지막 댓글 timeline에 저장시 callback함수 호출");
                                callback(null, timelines);
                            }
                        } else { //댓글이 없을경우
                            timeline.reply = null;
                            if (idx === (timelines.length - 1)) {
                                connection.end();
                                console.log("마지막 댓글 timeline에 저장시 callback함수 호출");
                                callback(null, timelines);
                            }
                        }
                    });
                });
            }
        ],
        function (err, timelines) {
            if (err) {
                console.log(err);
                res.jsonp({"Error": err});
            } else {
                console.log(util.inspect(timelines)); //전달받은 timelines 객체를 JSON 객체로 전달
                res.jsonp({"timelines": timelines});
            }
        }
    );
};