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


//동물의 프로필 등록
exports.createPetProfile = function (req, res) {
    logger.info(format('dev', req, res));
    /*	req.form.on("progress", function(receivedBytes, expectedBytes) {//receivedBytes : 현재진행 크기  //expectedBytes : 전체크기
     console.log(((receivedBytes / expectedBytes) * 100).toFixed(1));
     //100분율로 표시해주는데 소수점 한자리 까지표시
     });

     //req.form.on("end", function() {
     */
    //not null var
    var user_id = req.body.user_id;		//어떤 사용자가 동물을 등록할지에 대한 ID
    var pet_name = req.body.pet_name;	//등록할 동물의 이름
    var birth = req.body.birth;			//동물의 생일
    var sex = req.body.sex;				//동물의 성별
    //null 허용 var
    var pet_region = null;				//동물이 사는 지역
    var pet_speciality = null;			//동물의 특기
    var pet_like = null;				//동물이 좋아하는 것
    var pet_hate = null;				//동물이 싫어하는 것
    var pet_love = null;				//동물의 연애여부

    //클라이언트에서 입력값이 있으면 입력
    //없으면 null
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
    var ori_photo_name;					//프로필 사진의 원본 파일명
    var for_del_path;					//transaction 에 필요한 임시 저장공간

    var files = [];
    for (var prop in req.files) {
        files.push(req.files[prop]);
    }
    /////////////////////////////////////////
    //동물의 사진을 등록할 때 수행되는 코드//
    /////////////////////////////////////////
    if (files.length > 0) {
        files.forEach(function (file) {	//업로드된 파일을 배열에 저장한다
            ori_photo_name = file.name;	//원본파일명 저장

            easyimage.info(file.path, function (err, image) {
                console.log(image);		//이미지파일의 정보 출력

                ///////////////////////////////////////////////////////////////
                //파일 이동
                ///////////////////////////////////////////////////////////////
                fstools.move(file.path, "./images/" + image.name + ".jpg", function (err) {
                    if (err) {
                        res.jsonp({"error": "image file upload Fail."});
                    } else {
                        //업로드 된 사진 파일의 경로를 저장
                        pet_photo_path = serverUrl + ':80/' + path.basename(file.path) + '.jpg';
                        for_del_path = './images/' + path.basename(file.path) + '.jpg';
                        console.log("pet_photo_path : " + pet_photo_path);
                        console.log("for_del_path : " + for_del_path);
                        console.log("Original file moved!!!");
                        ///////////
                        //DB 시작//
                        ///////////
                        pool.getConnection(function (err, connection) {		//pool 에서 connection을 가져온다
                            queues(connection, true);

                            var trans = connection.startTransaction();		//트랜젝션 시작하는 변수

                            console.log('데이터베이스 연결합니다.');
                            console.log('pet_photo_path : ' + pet_photo_path);
                            console.log('ori_photo_name : ' + ori_photo_name);
                            //body에서 전송된 동물의 정보를 DB에 입력한다
                            trans.query("insert into pet (user_id, reg_date, pet_name, birth, sex, pet_photo_path, ori_photo_name, pet_region, pet_speciality, pet_like, pet_hate, pet_love) " +
                                'values (?,now(),?,?,?, "' + pet_photo_path + '", "' + ori_photo_name + '",?,?,?,?,?) ',
                                [user_id, pet_name, birth, sex, pet_region, pet_speciality, pet_like, pet_hate, pet_love],
                                function (err, result) {
                                    console.log("Error : " + err);
                                    console.log(util.inspect(result));
                                    console.log("for_del_path : " + for_del_path);
                                    if (err) {
                                        console.log('여기서 에러야1');
                                        trans.rollback(function (err, info) {
                                            if (err) {
                                                console.log(err);
                                                connection.end();
                                            }
                                            ////////////////////////////////////
                                            //DB입력 에러시 업로드한 파일 삭제//
                                            ////////////////////////////////////
                                            console.log('for_del_path : ' + for_del_path);
                                            fstools.remove(for_del_path, function (err) {
                                                if (err)
                                                    console.log('Fail deleting photo file.');
                                                console.log("DB에러 파일삭제 완료");
                                            });
                                        });
                                        connection.end(function () {
                                            console.log("Error : Fail crate new pet_profile");
                                            res.jsonp({"error": "Fail creating new pet_profile "});
                                        });

                                    } else {
                                        trans.commit(function () {
                                            connection.end();
                                            console.log("Profile created success");
                                            res.jsonp({"message": "Profile created success"});
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
        /////////////////////////////////////////////////
        //동물의 사진을 등록하지 않았을때 수행되는 코드//
        ////////////////////////////////////////////////
        //DB 시작//
        //////////
        pool.getConnection(function (err, connection) {
            console.log('데이터베이스 연결합니다.');
            //입력된 동물의 프로필 정보를 DB에 입력
            connection.query("insert into pet (user_id, reg_date, pet_name, birth, sex, pet_region, pet_speciality, pet_like, pet_hate, pet_love) " +
                "values (?,now(),?,?,?,?,?,?,?,?) ",
                [user_id, pet_name, birth, sex, pet_region, pet_speciality, pet_like, pet_hate, pet_love],
                function (err, result) {
                    console.log(util.inspect(result));
                    if (err) {	//에러코드
                        console.log('여기서 에러야1');
                        connection.end();
                        res.jsonp({"error": "Fail creating new pet_profile "});
                    } else {	//정상작동시
                        connection.end();
                        res.jsonp({"": "profile created success."});
                    }
                });
        });
        /////////////
        //DB입력 끝//
        /////////////
    }
};
