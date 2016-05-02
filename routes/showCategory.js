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


//카테고리 별 타임라인
exports.showCategory = function (req, res) {
    logger.info(format('dev', req, res));
    async.waterfall([
        function (callback) {
            console.log('async.waterfall #1');

            var sort_type = req.query.sort_type;    //정렬타입
            var category = req.params.category;     //카테고리
            var my_id = req.query.my_id;            //접속한사용자의ID
            var page_cnt = (req.query.page_cnt - 1) * 10;
            var timelines = [];

            pool.getConnection(function (err, connection) {
                console.log('데이터베이스 연결을 pool에서 가져옵니다');

                if (err) {
                    if (connection !== undefined) {
                        connection.end();
                    }
                    callback(err);
                }

                if (sort_type === 'like_cnt') {
                    sort_type = ' like_cnt desc, wr_date desc ';
                } else {
                    sort_type = ' wr_date desc ';
                }

                //카테고리별 게시글의 내용을 불러오는 쿼리
                connection.query('select id, wr_date, user_id, wr_category, like_cnt, wr_content, pet_id, pet_name, pet_photo_path, wr_video_path, wr_video_thumb_path ' +
                    '  from timeline ' +
                    ' where wr_category = ? ' +
                    ' order by ' + sort_type +
                    ' limit ?, 10', [category, page_cnt], function (err, rows) {
                    if (err) {
                        connection.end(function () {
                            console.log("Fail in select timelines");
                            res.jsonp({"Error": "Fail in select timelines"});
                        });

                    }
                    if (rows.length > 0) {	//글이 있을 경우
                        rows.forEach(function (row, idx, array) {	//각 글별로 접속한 사용자의 좋아요 유무 체크
                            connection.query('select timeline_id ' +
                                '  from like_timeline ' +
                                ' where user_id=? and timeline_id=?', [my_id, row.id], function (err, result) {
                                if (err) {
                                    console.log("좋아요 한글 목록 땡겨오기 실패");
                                    res.jsonp({"Error": "Fail in like_timelines list"});
                                }
                                var like_yes_no;
                                if (result.length > 0) {	//좋아요를 했으면 true
                                    like_yes_no = true;
                                } else {					//좋아요를 하지 않았으면 false
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
                                    "reply": []	//각 글의 댓글을 저장하는 배열
                                };
                                timelines[idx] = timeline;
                                if (idx === (array.length - 1)) {	//마지막 글일때 callback
                                    callback(null, connection, timelines);
                                    connection.end();
                                }
                            });
                        });
                    } else {
                        console.log("해당 카테고리에 글이 없습니다");
                        timelines = null;
                        callback(null, connection, timelines);

                    }
                });
            });
        },

        function (connection, timelines, callback) {
            console.log('async.waterfall #2');
            // 댓글을 timelines의 원소의 reply 속성에 추가
            if (timelines === null) {
                connection.end(function () {
                    callback(null, timelines);
                });

            } else {
                timelines.forEach(function (timeline, idx) {
                    connection.query('select id, pet_id, re_date, re_content, pet_name, pet_photo_path' +
                        '  from reply ' +
                        ' where timeline_id = ? ' +
                        ' order by re_date', [timeline.id], function (err, replies) {
                        if (replies.length > 0) {	//댓글이있으면 배열 째로 저장
                            timelines[idx].reply = replies;
                        }
                        if (idx === (timelines.length - 1)) {	//마지막 글이면 callback함수 호출
                            connection.end();
                            callback(null, timelines);
                        }
                    });
                });
            }
        }], function (err, timelines) {
        if (err) {
            console.log(err);
            res.jsonp({"message": err});
        } else {		//callback함수로 전달된 timelines 객체 를 JSON 객체로 전달
            console.log("Show category success");
            res.jsonp({"timelines": timelines});
        }
    });
};
