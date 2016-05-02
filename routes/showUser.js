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


//사용자 페이지
exports.showUser = function (req, res) {
    logger.info(format('dev', req, res));
    async.waterfall([	//waterfall시작
        function (callback) {
            console.log('async.waterfall #1');
            var sort_type = req.query.sort_type;			//정렬기준
            var timelines = [];								//타임라인을 저장할 배열
            var user_id = req.params.user_id;				//들어간 페이지의 사용자의 고유 ID
            var my_id = req.query.my_id;					//접속한 사용자의 고유 ID
            var page_cnt = (req.query.page_cnt - 1) * 10;

            pool.getConnection(function (err, connection) {	//DB 연결을 pool에서 가져옵니다
                console.log('데이터베이스 연결!!');
                if (err) {
                    if (connection !== undefined)
                        connection.end();
                    callback(err);
                }
                if (sort_type === 'like_cnt') {						//정렬기준이 좋아요 순일경우
                    sort_type = ' like_cnt desc, wr_date desc ';	//좋아요 개수가 같은경우 시간역순으로 정렬
                } else {											//좋아요 순이 아닐경우
                    sort_type = ' wr_date desc ';					//날짜 순으로 정렬
                }
                //각 글들의 정보를 DB에서 select
                connection.query('select id, wr_date, user_id, wr_category, like_cnt, wr_content, pet_id, pet_name, pet_photo_path, wr_video_path, wr_video_thumb_path ' +
                    '  from timeline ' +
                    ' where user_id = ? ' +
                    ' order by ' + sort_type +
                    ' limit ?, 10', [user_id, page_cnt], function (err, rows) {
                    if (rows.length == 0) {
                        timelines = null;
                        callback(null, connection, timelines, user_id, my_id, page_cnt);

                    } else {
                        //각 글별로 추가 속성을 주기위한 forEach문
                        rows.forEach(function (row, idx, array) {
                            //my_id 사용자가 각 글의 좋아요 여부를 알기위한 코드
                            connection.query('select timeline_id ' +
                                '  from like_timeline ' +
                                ' where user_id=? and timeline_id=?', [my_id, row.id], function (err, result) {
                                var like_yes_no;
                                if (result.length > 0) {    //해당 글을 좋아요 누른적이
                                    like_yes_no = true;    //있으면 true
                                } else {
                                    like_yes_no = false;    //없으면 false
                                }
                                var timeline = {    //각 글에 표시되는 정보
                                    "id": row.id,                  //각 글의 고유 ID
                                    "wr_date": row.wr_date,              //글을 게시한 시간
                                    "user_id": row.user_id,              //글을 게시한 사용자의 ID
                                    "wr_category": row.wr_category,          //글의 카테고리
                                    "like_cnt": row.like_cnt,            //글이 좋아요를 받은 수
                                    "wr_content": row.wr_content,          //글의 본문내용
                                    "pet_id": row.pet_id,              //글을 게시한 동물의 고유 ID
                                    "pet_name": row.pet_name,            //동물의 이름
                                    "pet_photo_path": row.pet_photo_path,      //동물의 프로필 사진의 URL
                                    "wr_video_path": row.wr_video_path,        //게시된 동영상의 URL
                                    "wr_video_thumb_path": row.wr_video_thumb_path,  //동영상의 썸네일 URL
                                    "like_yes_no": like_yes_no,            //my_id의 사용자가 글을 좋아요 눌렀는지 여부
                                    "reply": []                    //각 글의 댓글을 저장하는 배열
                                };
                                timelines[idx] = timeline;              //각 글을 timelines 배열에 저장한다
                                if (idx === (array.length - 1))           //배열의 마지막일 경우
                                    callback(null, connection, timelines, user_id, my_id, page_cnt);    //callback함수 호출
                            });
                        });
                    }
                });
            });
        },

        function (connection, timelines, user_id, my_id, page_cnt, callback) {
            console.log('async.waterfall #2');
            // 댓글을 timelines 의 원소의 reply 속성에 추가합니다.
            if (timelines == null) {
                callback(null, connection, timelines, user_id, my_id, page_cnt);
            } else {
                timelines.forEach(function (timeline, idx) {
                    connection.query('select id, pet_id, re_date, re_content, pet_name, pet_photo_path' +
                        '  from reply ' +
                        ' where timeline_id = ? ' +
                        ' order by re_date', [timeline.id], function (err, replies) {
                        if (replies.length > 0) {       //댓글이 있는 경우
                            timelines[idx].reply = replies;
                        }
                        if (idx === (timelines.length - 1)) { //마지막 댓글을 입력했을 경우
                            callback(null, connection, timelines, user_id, my_id, page_cnt);  //callback함수 호출
                        }
                    });
                });
            }
        },

        function (connection, timelines, user_id, my_id, page_cnt, callback) {
            console.log('async.waterfall #3');
            //새로운 객체를 만들어서 pet 의 정보와 해당 타임라인을 보여줍니다.

            var user_page = {
                "timelines": [],
                "user_info": {
                    "pet_info": [],
                    "wr_cnt": 0, // 사용자가 쓴 글의 개수를 카운트
                    "user_like_cnt": 0, // 사용자의 글이 좋아요를 받은 개수 카운트
                    "friends_cnt": 0, // 사용자의 친구 수
                    "nickname": null,
                    "friend_check": 0 // 남이냐 / 친구냐 / 친구요청중이냐 / 상대방이 나에게 친구신청을 했느냐를 알려주는 값
                    //남 : 0
                    //친구 : 1
                    //내가 친구요청중 : 2
                    //상대방이 나에게 친구신청을 했느냐 : 3
                    //나 자신의 page 이냐
                }
            };
            user_page.timelines = timelines;
            //해당 사용자의 반려동물에 대한 정보를 보여준다
            connection.query('select id, pet_photo_path, pet_name ' +
                '  from pet ' +
                ' where user_id = ? ', [user_id], function (err, pet_info) {
                if (err) {				//에러 발생 시 callback 함수 호출
                    callback(err);
                } else {				//에러 없을 시 동물의 정보를 저장하고 callback 함수 호출
                    user_page.user_info.pet_info = pet_info;
                    callback(null, connection, user_page, user_id, my_id, page_cnt);
                }
            });
        },
        function (connection, user_page, user_id, my_id, page_cnt, callback) {
            console.log('async.waterfall #4');
            //앞에서 넘어온 timelines가 null일 경우
            if (user_page.timelines == null && page_cnt == 1) {
                user_page.user_info.wr_cnt = 0;
                user_page.user_info.user_like_cnt = 0;
                callback(null, connection, user_page, user_id, my_id, page_cnt);
            } else {                           //앞에서 넘어온 timelines의 내용이 있을 경우
                //사용자가 쓴 글의 개수와 / 사용자가 쓴 모든 글이 좋아요를 받은 수의 합입니다
                connection.query('select sum(case when id then 1 else 0 end) as wr_cnt, ' +
                    '       sum(like_cnt) as user_like_cnt ' +
                    '  from timeline ' +
                    ' where user_id = ? ', [user_id], function (err, user_info_cnt) {
                    console.log(util.inspect(user_info_cnt));
                    if (err) {      //에러 발생 시 callback 함수 호출
                        callback(err);
                    } else {      //에러 없을 시 select된 정보 저장후 callback 함수 호출
                        user_page.user_info.wr_cnt = user_info_cnt[0].wr_cnt;
                        user_page.user_info.user_like_cnt = user_info_cnt[0].user_like_cnt;
                        callback(null, connection, user_page, user_id, my_id);
                    }
                });
            }
        },
        function (connection, user_page, user_id, my_id, callback) {
            console.log('async.waterfall #5');
            //친구의 수를 카운트 해주는 코드
            //친구가 없을경우 해줘야돼

            connection.query('select count(*) as friends_cnt ' +
                '  from friend ' +
                ' where s_user_id = ? and friend_check = 1 ', [user_id], function (err, result) {
                if (err) {			//에러 발생 시 콜백함수 호출
                    callback(err);
                } else {			//에러 없을시 select된 정보 저장후 callback함수 호출
                    if (result.length > 0) {
                        user_page.user_info.friends_cnt = result[0].friends_cnt;
                        callback(null, connection, user_id, user_page, my_id);
                    }
                }
            });
        },
        function (connection, user_id, user_page, my_id, callback) {
            console.log('async.waterfall #6');
            //집 이름에 들어갈 nickname 을 select
            connection.query('select nickname ' +
                '  from user ' +
                ' where id = ? ', [user_id], function (err, result) {
                if (err) {
                    callback(err);
                } else {
                    user_page.user_info.nickname = result[0].nickname;
                    callback(null, connection, user_id, user_page, my_id);
                }
            });
        },
        function (connection, user_id, user_page, my_id, callback) {
            console.log('async.waterfall #7');
            //friend_check 은 클라이언트 단에서 My page가 아닌 다른 사용자의 page로 들어갔을 경우에
            //친구 신청 상태를 나타내주기 위한 구분자입니다.
            //0 : 남남
            //1 : 친구
            //2 : 내가 친구요청중
            //3 : 상대방이 나에게 친구신청을 했을때
            //4 : 자기자신의 페이지
            connection.query('select friend_check ' +
                '  from friend ' +
                ' where s_user_id = ? and r_user_id = ?', [my_id, user_id], function (err, result) {
                if (err) {
                    callback(err);
                } else {						//친구/내가요청중/상대방이 나에게 친구요청중이면
                    if (result.length > 0) {	//값 저장, DB연결 종료, callback 호출
                        user_page.user_info.friend_check = result[0].friend_check;
                        connection.end();
                        callback(null, user_page);
                    } else {					//남남이거나 자기자신의 페이지일 경우에
                        if (my_id !== user_id) {	//남남이면
                            user_page.user_info.friend_check = 0;
                        } else {					//자기자신이면
                            user_page.user_info.friend_check = 4;
                        }
                        connection.end();
                        callback(null, user_page);
                    }
                }
            });
        }], function (err, user_page) {
        if (err) {
            console.log(err);
        } else {
            console.log("showUser Success!!");
            res.jsonp({"user_page": user_page});
        }
    });
};