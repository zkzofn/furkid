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

//각 사용자별로 Favorite 탭에서 화면구성
exports.showUserFavorite = function (req, res) {
    logger.info(format('dev', req, res));
    async.waterfall([
        function (callback) {
            console.log('async.waterfall #1');

            var timelines = [];
            var my_id = req.query.my_id;
            var page_cnt = (req.query.page_cnt - 1) * 10
            var user_id = req.params.user_id;
            pool.getConnection(function (err, connection) {
                if (err) {
                    if (connection !== undefined) {
                        connection.end();
                    }
                    callback(err);
                }
                //사용자가 좋아요를 눌렀던 글들을 select 하여 최신순으로 보여준다
                connection.query('select t.id, t.wr_date, t.user_id, t.wr_category, t.like_cnt, t.wr_content, t.pet_id, t.pet_name, t.pet_photo_path, t.wr_video_path, t.wr_video_thumb_path ' +
                    '  from timeline t join like_timeline lt on t.id = lt.timeline_id ' +
                    ' where lt.user_id = ? ' +
                    ' order by t.wr_date desc ' +
                    ' limit ?, 10', [user_id, page_cnt], function (err, rows) {
                    if (rows.length === 0) {	//좋아요 한 글이 없을 때
                        console.log("좋아요 한 글이 없음");
                        timelines = null;
                        callback(null, connection, timelines, user_id, my_id);

                    } else {	//좋아요 한 글이 있을 때
                        rows.forEach(function (row, idx, array) {	//각 글별로 속성저장
                            //사용자가 좋아요 누른 글의 ID를 찾아서
                            connection.query('select timeline_id ' +
                                '  from like_timeline ' +
                                ' where user_id=? and timeline_id=?',
                                [my_id, row.id], function (err, result) {
                                    var like_yes_no;
                                    if (result.length > 0) {	//값이있으면  true 없으면 false
                                        like_yes_no = true;
                                    } else {
                                        like_yes_no = false;
                                    }
                                    var timeline = {									//각 글에 표시되는 정보
                                        "id": row.id, 									//각 글의 고유 ID
                                        "wr_date": row.wr_date, 						//글을 게시한 시간
                                        "user_id": row.user_id, 						//글을 게시한 사용자의 ID
                                        "wr_category": row.wr_category, 				//글의 카테고리
                                        "like_cnt": row.like_cnt, 						//글이 좋아요를 받은 수
                                        "wr_content": row.wr_content, 					//글의 본문내용
                                        "pet_id": row.pet_id, 							//글을 게시한 동물의 고유 ID
                                        "pet_name": row.pet_name, 						//동물의 이름
                                        "pet_photo_path": row.pet_photo_path, 			//동물의 프로필 사진의 URL
                                        "wr_video_path": row.wr_video_path, 			//게시된 동영상의 URL
                                        "wr_video_thumb_path": row.wr_video_thumb_path,//동영상의 썸네일 URL
                                        "like_yes_no": like_yes_no, 					//my_id의 사용자가 글을 좋아요 눌렀는지 여부
                                        "reply": []									//각 글의 댓글을 저장하는 배열
                                    };
                                    timelines[idx] = timeline;
                                    if (idx === (array.length - 1))		//마지막 글일 일때 callback함수 호출
                                        callback(null, connection, timelines, user_id, my_id);
                                });
                        });
                    }
                });
            });
        },

        function (connection, timelines, user_id, my_id, callback) {
            console.log('async.waterfall #2');
            // 댓글을 timelines의 원소의 reply 속성에 추가합니다.
            if (timelines === null) {
                callback(null, connectoin, timeline, user_id, my_id);
            } else {
                timelines.forEach(function (timeline, idx, array) {
                    connection.query('select id, pet_id, re_date, re_content, pet_name, pet_photo_path' +
                        '  from reply ' +
                        ' where timeline_id = ? ' +
                        ' order by re_date desc ', [timeline.id], function (err, replies) {
                        if (replies.length > 0) {
                            timelines[idx].reply = replies;
                        }
                    });

                    if (idx === (array.length - 1))
                        callback(null, connection, timelines, user_id, my_id);
                });
            }
        },

        function (connection, timelines, user_id, my_id, callback) {
            console.log('async.waterfall #3');
            //새로운 객체를 만들어서 pet의 정보와 해당 타임라인을 보여줍니다.
            var user_page = {
                "timelines": [],
                "user_info": {
                    "pet_info": [],
                    "wr_cnt": 0, // 사용자가 쓴 글의 개수를 카운트
                    "user_like_cnt": 0, // 사용자의 글이 좋아요를 받은 개수 카운트
                    "friends_cnt": 0, // 사용자의 친구 수
                    "friend_check": 0 // 남이냐 / 친구냐 / 친구요청중이냐 / 상대방이 나에게 친구신청을 했느냐를 알려주는 값
                    //남 : 0
                    //친구 : 1
                    //내가 친구요청중 : 2
                    //상대방이 나에게 친구신청을 했느냐 : 3
                    //자기자신의 페이지 일때는 : 4
                }
            };
            user_page.timelines = timelines;	//timelines객체를 user_page객체에 저장
            //사용자가 소유한 동물의 정보를 select 하여 pet_info로 저장
            connection.query('select id, pet_photo_path, pet_name ' +
                '  from pet ' +
                'where user_id = ? ', [user_id], function (err, pet_info) {
                if (err) {
                    callback(err);
                } else {
                    user_page.user_info.pet_info = pet_info;
                    callback(null, connection, user_page, user_id, my_id);
                }
            });
        },
        function (connection, user_page, user_id, my_id, callback) {
            console.log('async.waterfall #4');
            //사용자가 쓴 글의 개수와 / 사용자가 쓴 모든 글이 좋아요를 받은 수의 합
            connection.query('select sum(case when id then 1 else 0 end) as wr_cnt, ' +
                '       sum(like_cnt) as user_like_cnt ' +
                '  from timeline ' +
                ' where user_id = ? ', [user_id], function (err, user_info_cnt) {
                if (err) {
                    callback(err);
                } else {
                    user_page.user_info.wr_cnt = user_info_cnt.wr_cnt;
                    user_page.user_info.user_like_cnt = user_info_cnt.user_like_cnt;
                    callback(null, connection, user_page, user_id, my_id);
                }
            });
        },
        function (connection, user_page, user_id, my_id, callback) {
            console.log('async.waterfall #5');
            //친구의 수를 카운트 해주는 작업입니다.
            connection.query('select count(*) as friends_cnt ' +
                '  from friend ' +
                ' where s_user_id = ? and friend_check = 1 ', [user_id], function (err, result) {
                if (err) {
                    callback(err);
                } else {
                    if (result.length > 0) {
                        user_page.user_info.friends_cnt = result[0].friends_cnt;
                        connection.end();
                        callback(null, connection, user_id, user_page, my_id);
                    }
                }
            });
        },
        function (connection, user_id, user_page, my_id, callback) {
            console.log('async.waterfall #6');
            //사용자의 nickname 을 select 하는 작업
            connection.query('select nickname ' +
                '  from user ' +
                ' where id = ? ', [user_id], function (err, result) {
                user_page.user_info.nickname = result[0].nickname;
                callback(null, connection, user_id, user_page, my_id);
            })
        },
        function (connection, user_id, user_page, my_id, callback) {
            console.log('async.waterfall #7');
            //friend_check 은 클라이언트 단에서 My page가 아닌 다른 사용자의 page로 들어갔을 경우에
            //친구 신청 상태를 나타내주기 위한 구분자입니다.
            //0 : 남남
            //1 : 친구
            //2 : 내가친구요청중
            //3 : 상대방이 나에게 친구신청을 했을때
            //4 : 자기자신의 페이지
            connection.query('select friend_check ' +
                '  from friend ' +
                ' where s_user_id = ? and r_user_id = ?', [my_id, user_id], function (err, result) {
                if (err) {
                    callback(err);
                } else {
                    if (result.length > 0) {	//친구/내가신청중/나에게신청이왔을/ 경우
                        user_page.user_info.friend_check = result[0].friend_check;
                        connection.end();
                        callback(null, user_page);
                    } else {
                        if (my_id !== user_id) {	//남남이거나 자기자신의 페이지일 경우
                            user_page.user_info.friend_check = 0;
                        } else {
                            user_page.user_info.friend_check = 4;
                        }
                        connection.end();
                        callback(null, user_page);
                    }
                }
            });
        }], function (err, user_page) {
        if (err) {
            res.jsonp({"error": err});
        } else {
            console.log(util.inspect(user_page));
            res.jsonp({"user_page": user_page});

        }
    });
};