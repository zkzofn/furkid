var express = require('express')
    //, routes = require('./routes')
    , http = require('http')
    , path = require('path')
    , util = require('util')
    , mysql = require('mysql')
    , winston = require('winston');

var login = require("./routes/login"),
    signup = require("./routes/signup"),
    showAll = require("./routes/showAll"),
    showFriends = require("./routes/showFriends"),
    showUser = require("./routes/showUser"),
    showUserFavorite = require("./routes/showUserFavorite"),
    showCategory = require("./routes/showCategory"),
    createNews = require("./routes/createNews"),
    createPetProfile = require("./routes/createPetProfile"),
    showPetProfile = require("./routes/showPetProfile"),
    updateNews = require("./routes/updateNews"),
    createReply = require("./routes/createReply"),
    deleteReply = require("./routes/deleteReply"),
    likeNews = require("./routes/likeNews"),
    report = require("./routes/report"),
    updateFriend = require("./routes/updateFriend"),
    updatePetProfile = require("./routes/updatePetProfile"),
    removeNews = require("./routes/removeNews"),
    showFriendsList = require("./routes/showFriendsList"),
    showReply = require("./routes/showReply"),
    removePetProfile = require("./routes/removePetProfile");

var app = express();

// all environments
app.set('port', process.env.PORT || 80);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.set("jsonp callback", true);
app.use(express.favicon());
//app.use(express.logger('dev'));
/*app.use(express.logger({
 format: ':remote-addr - :status [:date] :response-time ms :res[content-length] " :method :url " ":user-agent"'
 }));*/
app.use(express.cookieParser('my secret here'));
app.use(express.session());
app.use(express.compress());        //앞으로는 이걸 항상 바디파서 앞에 끼워줘야 한다 → 압축해서 보내겠다 하는 것
app.use(express.bodyParser({
    "uploadDir": __dirname + "/uploads", //파일이 올라올때 어느 디렉토리를 쓰겠느냐
    "keepExtensions": false,             //올라온파일에 대해서 확장자를 버리겠다
    "limit": 50 * 1024 * 1024,             //파일의 용량은 2MB로 제한하겠다      //2mb"로도 표시가능
    //--> 사진뿐만 아니라 전체 총량을 제한 하는 거다
    "defer": false                        //--> formidable 이 처리하도록 req.form 에 접근할 수 잇게해줌
}));
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'videos')));
app.use(express.static(path.join(__dirname, 'images')));
app.use(express.static(path.join(__dirname, '.')));
// development only
if ('development' == app.get('env')) {
    app.use(express.errorHandler());
}

app.post('/login', login.login);
app.post('/signup', signup.signup);
app.get('/news/type/:sort_type', showAll.showAll);
app.get('/news/friends/:my_id', showFriends.showFriends);
app.get('/news/user/:user_id', showUser.showUser);
app.get('/news/user/favorite/:user_id', showUserFavorite.showUserFavorite);
app.get('/news/category/:category', showCategory.showCategory);
app.post('/news/create', createNews.createNews);
app.post('/pet/profile/create', createPetProfile.createPetProfile);
app.get('/profile/:pet_id', showPetProfile.showPetProfile);
app.post('/news/update', updateNews.updateNews);
app.post('/reply/create', createReply.createReply);
app.post('/reply/delete', deleteReply.deleteReply);
app.post('/news/like', likeNews.likeNews);
app.post('/news/report', report.report);
app.post('/friend/update', updateFriend.updateFriend);
app.post('/profile/pet/update', updatePetProfile.updatePetProfile);
app.post('/news/remove', removeNews.removeNews);
app.get('/list/friends/:my_id', showFriendsList.showFriendsList);
app.get('/reply', showReply.showReply);
app.post('/pet/profile/remove', removePetProfile.removePetProfile);


http.createServer(app).listen(app.get('port'), function () {
    console.log('Express server listening on port ' + app.get('port'));
});
