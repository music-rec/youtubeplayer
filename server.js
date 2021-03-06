'use strict';

var url = require('url');
var querystring = require('querystring');
var ytdl = require('ytdl-core');

function readRangeHeader(range, total) {
  if (!range) { return; }
  var positions = range.replace('bytes=', '').split('-');

  var start = parseInt(positions[0], 10);
  var end = parseInt(positions[1], 10);

  var result = {
    start: isNaN(start) ? 0 : start,
    end: isNaN(end) ? (total - 1) : end
  };

  if (!isNaN(start) && isNaN(end)) {
    result.start = start;
    result.end = total - 1;
  }

  if (isNaN(start) && !isNaN(end)) {
    result.start = total - end;
    result.end = total - 1;
  }

  return result;
}

var NodeCache = require("node-cache");

var videoInfos = new NodeCache({ stdTTL: 600, checkperiod: 320 });
function youtubeInfo(videoId) {
  var info = videoInfos.get(videoId);
  if (info && info.formats) {
    return Promise.resolve(info);
  }
  return new Promise(function (resolve, reject) {
    ytdl.getInfo('http://youtu.be/' + videoId, {}, function (err, info) {
      if (err || !info) {
        reject(err);
      } else {
        videoInfos.set(videoId, info);
        resolve(info);
      }
    });
  });
}

var videoSizes = new NodeCache({ stdTTL: 2000, checkperiod: 1000 });
function youtubeSize(info, videoId, itag) {
  var size = +videoSizes.get(videoId + itag);
  if (size) {
    return Promise.resolve(size);
  }
  return new Promise(function (resolve, reject) {
    ytdl.downloadFromInfo(info, { quality: itag }).on('format', function (format) {
      if (format instanceof Error) {
        reject(error);
      } else {
        videoSizes.set(videoId + itag, format.size);
        resolve(format.size);
      }
    }).on('error', function () { reject('Not downloadable'); });
  });
}

function server(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(501);
    res.end();
    return;
  }
  var query = querystring.parse(url.parse(req.url).query);
  var videoId = query.v;
  var itag = +query.itag || 43;
  if (videoId) {
    youtubeInfo(videoId).then(function (info) {
      res.writeHead(302, {
        'Location': encodeURIComponent(info.title.replace(/ /g, '_')) +
          '-' + videoId + '.webm'
      });
      res.end();
    }, function (e) {
      res.writeHead(404);
      res.end('It seems the link you\'ve given is broken');
    });
    return;
  }

  videoId =
    (/([a-zA-Z0-9_-]{11})\.(webm|mp4|flv|3gp)($|\?)/.exec(req.url) || {})[1];
  if (!videoId) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<form method="GET">' +
      '<input name="v" placeholder="Enter your YouTube link here">' +
      '<input type="submit" onclick="document.forms[0].v.value = ' +
        'document.forms[0].v.value.replace(/.*(\\/|=)/m, \'\')"></form>');
    return;
  }

  youtubeInfo(videoId).then(function (info) {
    if (/\?info$/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json;charset=utf8' });
      res.end(JSON.stringify(info, 2, 2));
      return;
    }
    if (/\?list$/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<form method="GET"><select name="itag">' + info.formats.map(function (x) {
        return '<option value="' + x.itag + '">' + x.container + ' ' +
          (x.resolution || 'audio') + ' ' + (x.audioBitrate ? '' : 'mute') +
          '</option>';
      }).join('\n') + '</select><input type="submit"></form>');
      return;
    }

    youtubeSize(info, videoId, itag).then(function (size) {
      var options = { quality: itag };
      var range = readRangeHeader(req.headers.range, size);

      if (range) {
        // If the range can't be fulfilled.
        if (range.start >= size || range.end >= size) {
          // 416: 'Requested Range Not Satisfiable'
          res.writeHead(416, {
            'Content-Range': 'bytes */' + stat.size
          });
          res.end('Requested Range Not Satisfiable');
          return;
        }

        options.range = range.start + '-' + range.end;
      }

      ytdl.downloadFromInfo(info, options).on('format', function (format) {
        if (format instanceof Error) {
          res.writeHead(404);
        } else if (!range) {
          res.writeHead(200, {
            'Content-Length': format.size,
            'Content-Type': format.type,
            'Accept-Ranges': 'bytes'
          });
        } else {
          res.writeHead(206, {
            'Content-Range':
              'bytes ' + range.start + '-' + range.end + '/' + size,
            'Content-Length':
              range.start === range.end ? 0 : (range.end - range.start + 1),
            'Content-Type': format.type,
            'Accept-Ranges': 'bytes'
          });
        }
      }).on('error', function (e) {
        res.end((e || '').toString());
      }).pipe(res);
    }).then(undefined, function (error) {
      res.writeHead(404);
      res.end('Internal error: ' + error);
    });
  }, function (e) {
    res.writeHead(404);
    res.end('It seems the link you\'ve given is broken');
  });
}

var port = process.argv[2] || 9090;
require('http').createServer(server).listen(port, '0.0.0.0');
console.log('Server running at all interfaces on ' + port +
  ', http://127.0.0.1:' + port + '/');
