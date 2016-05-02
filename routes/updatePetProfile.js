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


exports.updatePetProfile = function (req, res) {
    logger.info(format('dev', req, res));
    /*req.form.on("progress", function(receivedBytes, expectedBytes) {//receivedBytes : 현재진행 크기  //expectedBytes : 전체크기
     console.log(((receivedBytes / expectedBytes) * 100).toFixed(1));
     //100분율로 표시해주는데 소수점 한자리 까지표시
     });

     req.form.on("end", function() {*/
    //not null var
    var pet_id = req.body.pet_id;		//어떤 동물의 프로필을 수정할 것인지에 한 정보
    var pet_name = req.body.pet_name;	//동물의 이름
    var birth = req.body.birth;			//동물의 생일
    var sex = req.body.sex;				//동물의 성별
    //null 허용 var
    var pet_region = null;				//동물이 사는지역
    var pet_speciality = null;			//동물의 특기
    var pet_like = null;				//동물이 좋아하는 것
    var pet_hate = null;				//동물이 싫어하는것
    var pet_love = null;				//동물의 연애여부
    var isMaintain = null;				//사진파일을 변경하지 않을 경우 기존의 사진을 유지할지 사진을 없앨지에 대한 구분자

    //클라이언트에서 입력값이 있으면 입력
    if (req.body.isMaintain)
        isMaintain = req.body.isMaintain;
    if (req.body.pet_region)
        pet_region = req.body.pet_region;
    if (req.body.pet_speciality)
        pet_speciality = req.body.pet_speciality;
    if (req.body.pet_like)
        pet_like = req.body.pet_like;
    if (req.body.pet_hate)
        pet_hate = req.body.pet_hate;
    if (req.body.pet_love)
        pet_love = req.body.pet_love;

    var pet_photo_path;					//동물의 프로필 사진 URL
    var ori_photo_name;					//프로필 사진의 원본파일명
    var for_del_path;					  //사진 삭제시 필요한 임시 변수
    var ori_pet_photo_path;     //사진 변경전 사진의 path

    var files = [];
    for (var prop in req.files) {		//파일을 배열에 저장
        files.push(req.files[prop]);
    }
    /////////////////////////////////////////
    //동물의 사진을 변경할 때 수행되는 코드//
    /////////////////////////////////////////
    if (files.length > 0) {
        files.forEach(function (file) {
            ori_photo_name = file.name;
            easyimage.info(file.path, function (err, image) {
                console.log(image);
                if (err) {
                    console.log("image 파일 업로드 제대로 안됨");
                    res.jsonp({"Error": "Fail in file upload"});
                }
                ///////////////////////////////////////////////////////////////
                //파일 이동
                ///////////////////////////////////////////////////////////////
                fstools.move(file.path, "./images/" + image.name + ".jpg", function (err) {
                    if (err) {  //파일이동 에러시 실행
                        console.log('Error : Fail in file move');
                        fstools.remove('./uploads/' + file.name, function () {  //upload된 파일 삭제
                            console.log('file removed');
                        });
                        res.jsonp({"error": "Fail in file move."});
                    } else {    //파일이동 성공시 실행
                        //업로드 된 사진 파일의 경로를 저장
                        console.log("image.name : " + image.name);
                        console.log('File moved success');
                        pet_photo_path = serverUrl + ':80/' + image.name + '.jpg';
                        for_del_path = './images/' + path.basename(file.path) + '.jpg';
                        console.log("Original file moved!!!");
                        ///////////
                        //DB 시작//
                        ///////////
                        pool.getConnection(function (err, connection) {
                            queues(connection, true);
                            var trans = connection.startTransaction();

                            //기존의 프로필 사진의 경로를 뽑아낸다  ///////////////////////////////////////////////////얘는 마지막 콜백안에 집어넣어
                            connection.query('select pet_photo_path ' +
                                '  from pet ' +
                                ' where id = ?', [pet_id], function (err, result_pet_id) {
                                if (err) {
                                    connection.end(function () {
                                        console.log("기존의 사진파일 path select 실패");
                                        res.jsonp({"Error": "Fail in select original file path"});
                                    });
                                }
                                if (result_pet_id[0].pet_photo_path === null) {  //기존에 등록한 사진이 없을때
                                    console.log("기존에 등록한 사진이 없습니다.");
                                } else {   //기존에 등록한 사진이 있으면 수행
                                    console.log("result_pet_id[0].pet_photo_path : " + result_pet_id[0].pet_photo_path);
                                    ori_pet_photo_path = result_pet_id[0].pet_photo_path.slice(65, 110);
                                    console.log("ori_pet_photo_path : " + ori_pet_photo_path);
                                }
                            });
                            console.log('pet_photo_path : ' + pet_photo_path);
                            console.log('ori_photo_name : ' + ori_photo_name);
                            ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                            //동물의 정보를 수정
                            trans.query("update pet set pet_name = '" + pet_name + "', birth = ?, sex = ?, pet_photo_path = '" + pet_photo_path + "', ori_photo_name = '" + ori_photo_name + "', pet_region = ?, pet_speciality = ?, pet_like = ?, pet_hate = ?, pet_love = ? " +
                                " where id = ? ",
                                [birth, sex, pet_region, pet_speciality, pet_like, pet_hate, pet_love, pet_id],
                                function (err, result) {
                                    if (err) {   //update 에러시 수행
                                        trans.rollback(function () {
                                            //DB입력 에러시 업로드한 파일 삭제//
                                            fstools.remove(for_del_path, function (err) {
                                                if (err)  //file remove 실패시 메세지
                                                    console.log('Fail in delete photo file.');
                                                console.log("Error : Fail in update pet_info");
                                                res.jsonp({"error": "Fail updating pet_profile "});
                                            });
                                        });
                                    }
                                    //update 성공시 수행
                                    //사진변경전 파일 지워줘야 한다
                                    console.log("사진을 변경할 것이야");
                                    if (ori_pet_photo_path === null) { // 기존에 사진이 없었던 경우
                                        console.log("기존의 사진이 없었어 \n ori_pet_photo_path : " + ori_pet_photo_path);
                                        trans.query('update timeline ' +
                                            '   set pet_photo_path = "' + pet_photo_path + '", pet_name = "' + pet_name + '" ' +
                                            ' where pet_id = ? ', [pet_id], function (err) {
                                            if (err) {
                                                trans.rollback(function () {
                                                    connection.end();
                                                    console.log("Error : Fail in timeline의 pet_name, pet_photo_path update");
                                                    res.jsonp({"Error": "Fail in timeline의 pet_name, pet_photo_path update"});
                                                });
                                            }
                                            trans.query('update reply ' +
                                                '   set pet_photo_path = "' + pet_photo_path + '", pet_name = "' + pet_name + '" ' +
                                                ' where pet_id = ? ', [pet_id], function (err) {
                                                if (err) {
                                                    trans.rollback(function () {
                                                        connection.end();
                                                        console.log("Error : Fail in reply 의 pet_name, pet_photo_path update");
                                                        res.jsonp({"Error": "Fail in reply 의 pet_name, pet_photo_path update"});
                                                    });
                                                } else {
                                                    connection.query('select id as pet_id, pet_name, pet_photo_path ' +
                                                        '  from pet ' +
                                                        ' where id = ? ', [pet_id], function (err, pet_info) {
                                                        if (err) {
                                                            connection.end(function () {
                                                                console.log("마지막 select에서 error");
                                                                res.jsonp({"Error": "Fail in lase select"});
                                                            });
                                                        }
                                                        trans.commit();
                                                        connection.end(function () {
                                                            console.log("Profile updated success");
                                                            res.jsonp({"pet_info": pet_info[0]});
                                                        });
                                                    });
                                                }
                                            });
                                        });
                                    } else {   //기존에 사진이 있었던경우 사진변경전 파일 지워줘야 한다
                                        fstools.remove("./images/" + ori_pet_photo_path, function (err) {
                                            if (err)
                                                console.log("변경전 사진 파일 삭제 실패!!!");
                                            console.log("변경전사진파일 삭제 완료");
                                            console.log("ori_pet_photo_path : " + ori_pet_photo_path);
                                        });
                                        trans.query('update timeline ' +
                                            '   set pet_photo_path = "' + pet_photo_path + '", pet_name = "' + pet_name + '" ' +
                                            ' where pet_id = ? ', [pet_id], function (err) {
                                            if (err) {
                                                trans.rollback(function () {
                                                    connection.end();
                                                    console.log("Error : Fail in timeline 의 pet_name, pet_photo_path update");
                                                    res.jsonp({"Error": "Fail in timeline 의 pet_name, pet_photo_path update"});
                                                });
                                            }
                                            trans.query('update reply ' +
                                                '   set pet_photo_path = "' + pet_photo_path + '", pet_name = "' + pet_name + '" ' +
                                                ' where pet_id = ? ', [pet_id], function (err) {
                                                if (err) {
                                                    trans.rollback(function () {
                                                        connection.end();
                                                        console.log("Error : Fail in reply 의 pet_name, pet_photo_path update");
                                                        res.jsonp({"Error": "Fail in reply 의 pet_name, pet_photo_path update"});
                                                    });
                                                }
                                                trans.commit(function () {
                                                    connection.query('select id as pet_id, pet_name, pet_photo_path ' +
                                                        '  from pet ' +
                                                        ' where id = ? ', [pet_id], function (err, pet_info) {
                                                        if (err) {
                                                            connection.end(function () {
                                                                console.log("마지막 select에서 error");
                                                                res.jsonp({"Error": "Fail in lase select"});
                                                            });
                                                        }
                                                        connection.end(function () {
                                                            console.log("Profile updated success");
                                                            res.jsonp({"pet_info": pet_info[0]});
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                    }
                                });
                            trans.execute();
                        });
                        /////////////
                        //DB입력 끝//
                        /////////////
                    }
                });
            });
        });
    } else {
        ////////////////////////////////////////////////
        //동물의 사진을 새로 등록하지 않았을때 수행되는 코드//
        ////////////////////////////////////////////////
        //DB 시작//
        ///////////
        pool.getConnection(function (err, connection) {
            queues(connection, true);
            console.log('데이터베이스 연결합니다.');
            var trans = connection.startTransaction();
            if (isMaintain == 1) {		//기존의 사진을 유지하고 동물의 정보만 변경
                trans.query("update pet set pet_name = '" + pet_name + "', birth = ?, sex = ?, pet_region = ?, pet_speciality = ?, pet_like = ?, pet_hate = ?, pet_love = ? " +
                    "where id = ? ",
                    [birth, sex, pet_region, pet_speciality, pet_like, pet_hate, pet_love, pet_id],
                    function (err, result) {
                        if (err) {
                            console.log('여기서 에러야1');
                            connection.end();
                            res.jsonp({"error": "Fail updating pet_profile "});
                        }
                        trans.query('update timeline ' +
                            '   set pet_name = "' + pet_name + '" ' +
                            ' where pet_id = ? ', [pet_id], function (err) {
                            if (err) {
                                trans.rollback(function () {
                                    connection.end();
                                    console.log("Error : Fail in timeline 의 pet_name, pet_photo_path update");
                                    res.jsonp({"Error": "Fail in timeline 의 pet_name, pet_photo_path update"});
                                });
                            }
                            trans.query('update reply ' +
                                '   set pet_name = "' + pet_name + '" ' +
                                ' where pet_id = ? ', [pet_id], function (err) {
                                if (err) {
                                    trans.rollback(function () {
                                        connection.end();
                                        console.log("Error : Fail in timeline, reply 의 pet_name, pet_photo_path update");
                                        res.jsonp({"Error": "Fail in timeline, reply 의 pet_name, pet_photo_path update"});
                                    });
                                }

                                trans.commit(function () {
                                    connection.query('select id as pet_id, pet_name, pet_photo_path ' +
                                        '  from pet ' +
                                        ' where id = ? ', [pet_id], function (err, pet_info) {
                                        if (err) {
                                            connection.end(function () {
                                                console.log("마지막 select에서 error");
                                                res.jsonp({"Error": "Fail in lase select"});
                                            });
                                        }
                                        connection.end(function () {
                                            console.log("Profile updated success");
                                            res.jsonp({"pet_info": pet_info[0]});
                                        });
                                    });
                                });
                            });
                        });
                    });
                trans.execute();

            } else {					//기존의사진을 없앨 때 수행되는 코드
                ///////////////////////////////////////////////////////////////////////////////////--> 파일수정하는거 해줘야돼
                //이미지파일 PATH 불러와서
                //임시변수에 저장
                //파일 삭제
                //파일 업로드
                //파일 path update

                //롤백하고나서 파일 삭제

                //동물의 정보를 변경
                trans.query("update pet set pet_name = '" + pet_name + "', birth = ?, sex = ?, pet_photo_path = null, ori_photo_name = null, pet_region = ?, pet_speciality = ?, pet_like = ?, pet_hate = ?, pet_love = ? " +
                    " where id = ? ",
                    [birth, sex, pet_region, pet_speciality, pet_like, pet_hate, pet_love, pet_id],
                    function (err, result) {
                        console.log(util.inspect(result));
                        if (err) {
                            console.log('여기서 에러야1');
                            connection.end();
                            res.jsonp({"error": "Fail creating new pet_profile "});
                        }
                        trans.query('update timeline t' +
                            '   set pet_photo_path = null, pet_name = "' + pet_name + '" ' +
                            ' where pet_id = ? ', [pet_id], function (err) {
                            if (err) {
                                trans.rollback(function () {
                                    connection.end();
                                    console.log("Error : Fail in timeline, reply 의 pet_name, pet_photo_path update");
                                    res.jsonp({"Error": "Fail in timeline, reply 의 pet_name, pet_photo_path update"});
                                });
                            }
                            trans.query('update reply' +
                                '   set pet_photo_path = null, pet_name = "' + pet_name + '" ' +
                                ' where pet_id = ? ', [pet_id], function (err) {
                                if (err) {
                                    trans.rollback(function () {
                                        connection.end();
                                        console.log("Error : Fail in timeline, reply 의 pet_name, pet_photo_path update");
                                        res.jsonp({"Error": "Fail in timeline, reply 의 pet_name, pet_photo_path update"});
                                    });
                                }
                                trans.commit(function () { //성공시에 pet_info를 넘겨주는 코드
                                    connection.query('select id as pet_id, pet_name, pet_photo_path ' +
                                        '  from pet ' +
                                        ' where id = ? ', [pet_id], function (err, pet_info) {
                                        if (err) {
                                            connection.end(function () {
                                                console.log("마지막 select에서 error");
                                                res.jsonp({"Error": "Fail in lase select"});
                                            });
                                        }
                                        connection.end(function () {
                                            console.log("Profile updated success");
                                            res.jsonp({"pet_info": pet_info[0]});
                                        });
                                    });
                                });
                            });
                        });
                    });
                trans.execute();
            }
        });
        /////////////
        //DB입력 끝//
        /////////////
    }
};