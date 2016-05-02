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


//게시글 등록
exports.createNews = function (req, res) {
    logger.info(format('dev', req, res));
    //not null
    var pet_id;				//글을 게시하는 동물의 ID		//int
    var wr_category;			//글의 카테고리					//char(1)
    var wr_public;			//글의 공개범위					//bool
    //null 허용
    var pet_photo_path;		//동물의 프로필 사진 URL		//varchar(200
    var wr_content;			//게시글의 내용					//varchar(200)
    var wr_video_path;		//글에 게시되는 동영상의 URL	//varchar(200)
    var wr_video_thumb_path;	//동영상의 썸네일의 URL 		//varchar(200)

    /*
     /////////////////////////////////////////////////////////////////////////////////////////////////////
     //동영상 전송
     req.form.on("progress", function(receivedBytes, expectedBytes) {
     console.log(((receivedBytes / expectedBytes) * 100).toFixed(1), "% received");
     });

     req.form.on("end", function() {
     */
    var files = [];				//업로드된 파일이 저장될 배열
    var for_del_path;			//동영상 삭제시 필요한 임시변수
    var for_del_thumb_path;		//동영상 썸네일 삭제시 필요한 임시변수

    for (var prop in req.files) {		//파일을 배열에 저장
        files.push(req.files[prop]);
    }

    files.forEach(function (file) {
        console.log("Original filename: ", file.name);

        var proc = new ffmpeg({		//동영상을 조작하기 위한 ffmpeg 객체 생성
            source: file.path,
            nolog: true
        });

        proc.withSize('720x?').takeScreenshots({		//동영상의 스크릿샷 설정
            count: 1,
            filename: '%i'
        }, "./videos/thumbs/" + path.basename(file.path), function (err, filenames) {

            wr_video_thumb_path = serverUrl + ':80/thumbs/' + path.basename(file.path) + "/" + path.basename(filenames);
            wr_video_path = serverUrl + ':80/' + path.basename(file.path);
            for_del_thumb_path = './videos/thumbs/' + path.basename(file.path);
            for_del_path = './videos/' + path.basename(file.path);
            //동영상, 썸네일의 URL 저장
            console.log('wr_video_path : ' + wr_video_path);
            console.log('wr_video_thumb_path : ' + wr_video_thumb_path);
            console.log('Screenshots saved!!!');

            console.log("file.path : " + file.path);
            console.log("path.basename(filenames) : " + path.basename(filenames));
            console.log("path.basename(file.path) : " + path.basename(file.path));
            console.log("thumbnail's filepath : " + path.dirname(file.path));

            easyimage.crop(
                {
                    src: './videos/thumbs/' + path.basename(file.path) + "/" + path.basename(filenames),
                    dst: './videos/thumbs/' + path.basename(file.path) + "/" + path.basename(filenames),
                    cropwidth: 720,
                    cropheight: 400,
                    gravity: 'Center',
                    x: 0, y: 0
                }, function (err, image) {
                    if (err) {
                        console.log("Error : Fail in making video_thumbnail");
                        console.log("err : " + err);
                        res.jsonp({"Error": "Fail in making video_thumbnail"});
                    }


                }
            );


            //파일이동
            fstools.move(file.path, "./videos/" + path.basename(file.path), function (err) {
                if (err) {
                    console.log("Error : Fail in files move");
                    res.jsonp({"Error": "Fail in files move"});
                }


                console.log("Original file moved!!!");

                ////////////////////////////////////////////////////////////////////////////////////
                //DB 입력

                pool.getConnection(function (err, connection) {

                    pet_id = req.body.pet_id;             //동물의 ID
                    wr_content = req.body.wr_content;     //게시글의 본문
                    wr_category = req.body.wr_category;   //게시글의 카테고리
                    wr_public = req.body.wr_public;       //게시글의 공개여부
                    //글을 게시한 동물의 정보출력
                    connection.query('select pet_name, pet_photo_path, user_id ' +
                        '  from pet ' +
                        ' where id = ? ', [pet_id], function (err, pet_result) {
                        if (err) {		//에러시 파일 삭제
                            console.log("pet_info select 실패");
                            console.log('for_del_path : ' + for_del_path);
                            fstools.remove(for_del_path, for_del_thumb_path, function (err) {//에러시 파일삭제
                                if (err)
                                    console.log('Error : 파일 삭제 실패!!');
                                console.log('파일 삭제 성공');
                            });
                            connection.end(function () {
                                console.log("Error : Failed selcect pet_info\nFail file delete");
                                res.jsonp({"Error": "Failed select pet_info\nSuccess file delete"});
                            });
                        }

                        if (pet_result.length > 0) {
                            //게시글에 필요한 데이터를 입력
                            connection.query("insert into timeline (pet_id, pet_name, pet_photo_path, user_id, wr_content, wr_date, wr_video_path, wr_video_thumb_path, wr_category, wr_public ) " +
                                "values (?,?,?,?,?,now(),?,?,?,?) ",
                                [pet_id, pet_result[0].pet_name, pet_result[0].pet_photo_path, pet_result[0].user_id, wr_content, wr_video_path, wr_video_thumb_path, wr_category, wr_public],
                                function (err, result) {
                                    if (err) {
                                        fstools.remove(for_del_path, for_del_thumb_path, function (err) {//에러시 파일삭제
                                            if (err)
                                                console.log("파일삭제 실패");
                                            console.log("파일삭제 성공");
                                        });
                                        connection.end(function () {
                                            console.log("요기 insert 실패");
                                            res.jsonp({"Error": "Failed insert pet_info"});
                                        });
                                    }
                                    connection.end(function () {
                                        console.log("newsCreate success!!");
                                        res.jsonp({'message': 'newsCreate Succecced!!'});
                                    });
                                });
                        } else { //pet_id 를 가진 동물이 존재하지 않을때 실행
                            fstools.remove(for_del_path, for_del_thumb_path, function (err) {//에러시 파일삭제
                                if (err)
                                    console.log('Error : Fail in deleting photo file.');
                                console.log("파일&동영상 파일 삭제완료");
                            });
                            connection.end(function () {
                                console.log("해당 pet_id 를 가진 동물이 존재하지 않습니다");
                                res.jsonp({"message": "Wrong pet_id"});
                            });
                        }
                    });
                });
                //DB 마지막
                ////////////////
            });
        });
    });
};