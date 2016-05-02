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

//모든 사용자의 게시글 보여주는 타임라인
exports.showAll = function (req, res) {
    logger.info(format('dev', req, res));
    async.waterfall(
        [
            function (callback) {		//waterfall 시작
                console.log('async.waterfall #1');

                var sort_type = req.params.sort_type;	//글을 정렬하는 순서
                var my_id = req.query.my_id;			//현재 접속하고 있는 사용자의 ID
                var timelines = [];					//각 게시글을 정렬하여 넣어서 timeline 으로 보여줄 배열 객체
                var page_cnt = (req.query.page_cnt - 1) * 10;

                pool.getConnection(function (err, connection) {
                    console.log('데이터베이스 연결을 pool에서 가져옵니다');
                    if (err) {		//DB 연결 실패시 callback 함수호출 에러처리
                        if (connection !== undefined) {
                            connection.end();
                        }
                        callback(err);
                    }

                    //like_cnt가 같을 경우에는 최신순으로 정렬해주기 위해 sort_type 값을 변형
                    if (sort_type === 'like_cnt') {
                        sort_type = ' like_cnt desc, wr_date desc ';
                    } else {
                        sort_type = ' wr_date desc ';
                    }
                    //sort_type 별로 정렬해서 게시글의 정보를 가져온다

                    connection.query('select id, wr_date, user_id, wr_category, like_cnt, wr_content, pet_id, pet_name, pet_photo_path, wr_video_path, wr_video_thumb_path ' +
                        '  from timeline ' +
                        ' order by ' + sort_type +
                        ' limit ?, 10 ', [page_cnt], function (err, rows) {
                        if (err) {  //select 실패시 에러처리
                            connection.end(function () {
                                callback("글을 가져올 수 없습니다.");
                            });
                        }
                        if (rows.length > 0) {
                            //각 select 된 각각의 글을 timelines 배열에 넣기위한 forEach문
                            rows.forEach(function (row, idx, array) {
                                //my_id의 사용자가 각 글에 대해 좋아요를 눌렀는지 알기위한 쿼리
                                connection.query('select timeline_id ' +
                                    '  from like_timeline ' +
                                    ' where user_id = ? and timeline_id = ?', [my_id, row.id], function (err, result) {
                                    var like_yes_no;
                                    if (result.length > 0) {  //결과값에 대해 변수를 생성해서 좋아요 여부를 저장
                                        like_yes_no = true;
                                    } else {
                                        like_yes_no = false;
                                    }
                                    var timeline = {   //각 글에 표시되는 정보
                                        "id": row.id,                                   //각 글의 고유 ID
                                        "wr_date": row.wr_date,                         //글을 게시한 시간
                                        "user_id": row.user_id,                         //글을 게시한 사용자의 ID
                                        "wr_category": row.wr_category,                 //글의 카테고리
                                        "like_cnt": row.like_cnt,                       //글이 좋아요를 받은 수
                                        "wr_content": row.wr_content,                   //글의 본문내용
                                        "pet_id": row.pet_id,                           //글을 게시한 동물의 고유 ID
                                        "pet_name": row.pet_name,                       //동물의 이름
                                        "pet_photo_path": row.pet_photo_path,           //동물의 프로필 사진의 URL
                                        "wr_video_path": row.wr_video_path,             //게시된 동영상의 URL
                                        "wr_video_thumb_path": row.wr_video_thumb_path, //동영상의 썸네일 URL
                                        "like_yes_no": like_yes_no,                     //my_id의 사용자가 글을 좋아요 눌렀는지 여부
                                        "reply": []                                     //각 글의 댓글을 저장하는 배열
                                    };
                                    timelines[idx] = timeline;               //각 게시글을 timelines 배열의 idx에 저장
                                    if (idx === (array.length - 1))             //select 된 result 배열의 마지막 index에서 callback 함수 호출
                                        callback(null, connection, timelines); //connection, timelines 를 다음 fucntion 으로 전달
                                });
                            });
                        } else {  //게시된 글이 없을 경우에 실행
                            connection.end(function () {
                                console.log("게시글이 없습니다");
                                res.jsonp({"timelines": null});
                            });
                        }
                    });
                });
            },
            function (connection, timelines, callback) {
                // 댓글을 timelines 의 각 timeline의 reply 속성에 추가합니다.
                console.log('async.waterfall #2');

                timelines.forEach(function (timeline, idx) {
                    connection.query('select id, pet_id, re_date, re_content, pet_name, pet_photo_path ' +
                        '  from reply ' +
                        ' where timeline_id = ? ' +
                        ' order by re_date', [timeline.id], function (err, replies) {
                        //오래된 순서로 정렬
                        if (err) {
                            console.log("Fail in select reply");
                        }
                        else if (replies.length > 0) {     //댓글이 있을 경우에 각 글의 reply배열에 replies 배열 저장
                            timeline.reply = replies;
                            if (idx == (timelines.length - 1)) {  //마지막 배열일때
                                connection.end();                //DB 연결 종료
                                callback(null, timelines);       //callback함수 호출 timelines 객체 arg 로 전달
                            }
                        } else {    //댓글이 없을경우
                            timeline.reply = null;
                            if (idx == (timelines.length - 1)) {  //마지막 배열일때
                                connection.end();                //DB 연결 종료
                                callback(null, timelines);       //callback함수 호출 timelines 객체 arg 로 전달
                            }
                        }
                    });
                });
            }
        ],
        //최종함수
        function (err, timelines) {
            if (err) {
                console.log(err);
                res.jsonp({"error": err});
            } else {
                console.log("showAll success!");
                res.jsonp({"timelines": timelines});					//timelines 객체 JSON 객체로 전달
            }
        }
    );
};