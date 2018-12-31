/**
 * Created by Alex on 27/11/2014.
 */


const gulp = require('gulp');
const clean = require('gulp-clean');
const concat = require('gulp-concat');
const notifier = require("node-notifier");
const connect = require('gulp-connect');
const sass = require('gulp-sass');
const rename = require('gulp-rename');
const event_stream = require('event-stream');

const RollupPluginCommonJS = require('rollup-plugin-commonjs');
const RollupPluginHtml = require('rollup-plugin-html');
const RollupPluginSass = require('rollup-plugin-sass');
const RollupPluginAlias = require('rollup-plugin-alias');

var gutil = require('gulp-util');
var through = require('through2');
var XLSX = require('xlsx');
var File = require('vinyl');

const fs = require('fs');

const html = 'app/index.html';
const lib = 'app/lib/**/*';

gulp.task('clean', function () {
    return gulp.src('public', { read: false })
        .pipe(clean());
});

gulp.task('html', function () {
    return gulp.src(html)
        .pipe(gulp.dest('public/'))
        .pipe(connect.reload());
});

gulp.task('lib', function () {
    return gulp.src(lib)
        .pipe(gulp.dest('public/lib/'))
        .pipe(connect.reload());
});

const styleGlob = 'app/css/**/*.css';
const sassGlob = 'app/css/**/*.scss';

gulp.task('css', function () {
    return event_stream.merge(
        gulp.src(styleGlob),
        gulp.src(sassGlob)
            .pipe(sass().on('error', sass.logError))
    )
        .pipe(concat('main.css'))
        .pipe(gulp.dest('public/css/'))
        .pipe(connect.reload());

});


const excelGlob = [
    'app/data/**/*.ods',
    'app/data/**/*.xls',
    'app/data/**/*.xlsx'
];

const localizationGlob = 'app/data/database/text/data.xlsx';

gulp.task('watch::localization', () => {
    return gulp.watch(localizationGlob, watchSettings, gulp.parallel('localization'));
});

gulp.task('localization', () => {
    const destination = 'database/text/';

    const converter = through.obj(function (file, enc, cb) {
        var task = this;
        if (file.isNull()) {
            this.push(file);
            return cb();
        }

        if (file.isStream()) {
            this.emit('error', new gutil.PluginError('Locale Lazy Kitty', 'Streaming not supported'));
            return cb();
        }


        /* Call XLSX */
        var workbook = XLSX.read(file.contents, { type: "buffer" });

        var worksheet = workbook.Sheets[workbook.SheetNames[0]];

        const j = XLSX.utils.sheet_to_json(worksheet, { raw: false, header: 1 });

        const headerRow = j[0];

        const languages = headerRow.slice(1);

        const rowCount = j.length;

        for (let i = 0; i < languages.length; i++) {
            const language = languages[i];

            //generate a key-value file
            var json = {};

            for (let k = 1; k < rowCount; k++) {
                const row = j[k];

                const key = row[0];
                const value = row[i + 1];

                if (value === undefined) {
                    //no value
                    continue;
                }


                //replace special characters
                const formattedValue = value.replace(/\&\#([a-fA-F0-9]+)\;/gi, function (match, code) {
                    return String.fromCharCode(code);
                });

                if (json.hasOwnProperty(key)) {

                    if (json[key] !== formattedValue) {
                        //re-definition
                        console.error(`duplicate key definition:'${key}', old value='${json[key]}', new value='${value}', keeping old value`);
                    }

                    continue;
                }

                json[key] = formattedValue;
            }


            const targetFile = new File({
                cwd: '.',
                path: destination + language + '.json', // put each translation file in a folder
                contents: Buffer.from(JSON.stringify(json, null, 4)),
            });

            task.push(targetFile);

            console.log("Written file :" + file.path + " => " + targetFile.path);

        }


        cb();
    });

    return gulp.src(localizationGlob)
        .pipe(converter)
        .pipe(gulp.dest(dataSourcePath))
});

gulp.task('release-build', () => {
    return makeReleaseBundler('bundle.js', './app/src/main.js', './public', '');
});

let dataTypesForCopy = ["json", "js"]
    .concat(["glb", "gltf"]) //3d models
    .concat(["png", "jpeg", "jpg", "svg", "dds"])
    .concat(["ogg", "mp3", "wav"])
    .concat(["ttf"]) //fonts
    .concat(["bin"]) //binary data
;

const dataSourcePath = "app/data";
const dataTargetPath = './public/data/';

const dataSlug = dataSourcePath + "/**/*.{" + dataTypesForCopy.concat(dataTypesForCopy.map(t => t.toLocaleUpperCase())).join(',') + "}";

gulp.task('copy-data', function () {
    return gulp.src(dataSlug)
        .pipe(rename((path) => {
            //convert all extensions to lower case
            path.extname = path.extname.toLocaleLowerCase();
        }))
        .pipe(gulp.dest(dataTargetPath));
});

gulp.task('copy-data-watch', function () {

    const watch = require('gulp-watch');

    function fileAdded(event) {
        console.log('file added', event);
    }

    function fileRemoved(event) {
        console.log('file unlinked', event);
    }

    function fileChanged(event) {
        console.log('file changed', event);
    }

    return watch(dataSlug)
        .on('add', fileAdded).on('change', fileChanged).on('unlink', fileRemoved)
        .pipe(rename((path) => {
            //convert all extensions to lower case
            path.extname = path.extname.toLocaleLowerCase();
        }))
        .pipe(gulp.dest(dataTargetPath));
});


let assetListFilePathStripped = "preloaderAssetList.json";
let assetListFilePath = dataSourcePath + "/" + assetListFilePathStripped;
let assetRootPath = "/data";

/**
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {function(err:*)} next
 */
function middleWareDisableCache(req, res, next) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Expires', '-1');
    res.setHeader('Pragma', 'no-cache');
    next()
}

let middleWareAssetListKeeper = (function () {
    let rFileExt = /\.([0-9a-z]+)(?:[\?#]|$)/i;


    function isAssetPath(path) {
        return path.indexOf(assetRootPath) === 0;
    }

    function fileExtensionFromPath(path) {
        //get extension of file
        let fileExtMatch = path.match(rFileExt);
        if (fileExtMatch !== null) {
            let fileExt = fileExtMatch[fileExtMatch.length - 1];
            return fileExt;
        }
        return null;
    }

    let assetHash = {};

    function guessAssetType(url, ext) {
        let assetDirectory = url.substring(assetRootPath.length);
        while (assetDirectory.charAt(0) === "/") {
            assetDirectory = assetDirectory.substr(1);
        }
        let iSlash = assetDirectory.indexOf("/");
        if (iSlash === -1) {
            assetDirectory = "";
        } else {
            assetDirectory = assetDirectory.substr(0, iSlash);
        }
        switch (ext) {
            case "json":
                switch (assetDirectory) {
                    case "models":
                        return "three.js";
                    case "levels":
                        return "level";
                    default:
                        return "json";
                }
            case "jpg":
            case "jpeg":
            case "png":
                return "image";
            case "ogg":
            case "mp3":
            //NOTE currently chrome doesn't seem to load these
            // return "sound";
            default :
                return null;
        }
    }

    function assetLevelByType(type) {
        switch (type) {
            case "image":
            case "three.js":
                return 1;
            case "level":
                return 0;
            case "sound":
            default :
                return 2;
        }
    }

    function tryRegisterAsset(url, ext) {
        if (!assetHash.hasOwnProperty(url)) {
            let type = guessAssetType(url, ext);
            if (type === null) {
                //ignore
                return;
            }
            let level = assetLevelByType(type);
            assetHash[url] = {
                "uri": url,
                "type": type,
                "level": level
            };
            writeAssetList();
        }
    }

    function writeAssetList() {
        let fileContents = [];
        for (let url in assetHash) {
            if (assetHash.hasOwnProperty(url)) {
                let urlStripped = url.substr(assetRootPath.length);
                if (urlStripped === assetListFilePathStripped) {
                    continue; //ignore file to which write will happen
                }
                fileContents.push(assetHash[url]);
            }
        }
        fs.writeFile(assetListFilePath, JSON.stringify(fileContents, 3, 3), function (err) {
            if (err) {
                return console.log(err);
            }
        });
    }

    function processRequest(req, res, next) {

        let url = req.url;
        if (isAssetPath(url)) {
            //strip leading slashes
            while (url.charAt(0) === "/") {
                url = url.substr(1);
            }
            let ext = fileExtensionFromPath(url);
            if (ext !== null) {
                tryRegisterAsset(url, ext)
            }
        }
        next();
    }

    return processRequest;
})();

gulp.task('clear-asset-list', function (done) {
    //clear out asset lists
    fs.writeFileSync(assetListFilePath, "[]");
    fs.writeFileSync(dataTargetPath + "/" + assetListFilePathStripped, "[]");
    done();
});

gulp.task('server-asset-recorder', gulp.series('clear-asset-list', function () {
    notifier.notify({
        title: "Server",
        message: "booted"
    });


    connect.server({
        root: 'public',
        middleware: function (connect, opt) {
            return [middleWareAssetListKeeper];
        },
        port: 8081,
        livereload: true
    });
}));

gulp.task('server', function () {
    notifier.notify({
        title: "Server",
        message: "booted"
    });

    return connect.server({
        root: 'public',
        port: 8080,
        livereload: true,
        middleware: function () {
            return [
                middleWareDisableCache
            ];
        }
    });
});

function makeReleaseBundler(name, source, destination, sourceRoot) {
    process.env.NODE_ENV = 'production';

    const rollup = require('rollup-stream');
    const buffer = require('vinyl-buffer');
    const uglify = require('gulp-uglify-es').default;

    const babel = require('rollup-plugin-babel');
    const nodeResolve = require('rollup-plugin-node-resolve');

    const RollupPluginUnassert = require('rollup-plugin-unassert');

    const replace = require('rollup-plugin-replace');

    const outputFile = destination + '/' + name;
    const outputFormat = 'iife';

    const config = {
        input: source,
        output: {
            file: outputFile,
            format: outputFormat
        },

        //included output fields here, due to the fact that rollup-stream module doesn't recognize real rollup.config.js file format
        //see https://github.com/Permutatrix/rollup-stream/issues/24
        file: outputFile,
        format: outputFormat,

        sourcemap: false,
        strict: true,
        plugins: [
            replace({
                'process.env.NODE_ENV': JSON.stringify('production')
            }),
            RollupPluginAlias({
            }),
            nodeResolve({ browser: true, jsnext: true }),
            RollupPluginCommonJS(),
            RollupPluginHtml(),
            RollupPluginSass({
                insert: true,
                include: '**/*.scss',
                exclude: [],
                options: { includePaths: ['node_modules/'] }
            }),
            RollupPluginUnassert(),
            babel({
                exclude: 'node_modules/**',
                babelrc: false,
                presets: ["@babel/preset-env"],
                plugins: []
            })
        ]
    };

    return rollup(config).on('error', console.error)
        .pipe(require('vinyl-source-stream')("uncompressed-" + name))
        .pipe(gulp.dest(destination))
        // buffering is required as uglify doesn't work on streams
        .pipe(buffer())
        //minify the code
        .pipe(uglify()).on('error', console.error)
        //set file name for output
        .pipe(rename(name))
        //write out the files
        .pipe(gulp.dest(destination));
}

/**
 *
 * @param {string} name
 * @param {string} source
 * @param {string} destination
 * @param {string} sourceRoot
 * @returns {*}
 */
function makeWatchBundler(name, source, destination, sourceRoot) {

    if (typeof name !== "string") {
        throw new TypeError(`name must be a string, instead was ${typeof name}`);
    }

    if (typeof source !== "string") {
        throw new TypeError(`source must be a string, instead was ${typeof source}`)
    }

    const rollup = require('rollup-stream');

    const babel = require('rollup-plugin-babel');

    const nodeResolve = require('rollup-plugin-node-resolve');

    const replace = require('rollup-plugin-replace');

    const watch = require('gulp-watch');

    const VinylFS = require('vinyl-fs');

    const VinylSourceStream = require('vinyl-source-stream');


    const outputFile = destination + '/' + name;
    const outputFormat = 'iife';


    const config = {
        input: source,
        output: {
            file: outputFile,
            format: outputFormat
        },

        //included output fields here, due to the fact that rollup-stream module doesn't recognize real rollup.config.js file format
        //see https://github.com/Permutatrix/rollup-stream/issues/24
        file: outputFile,
        format: outputFormat,

        sourcemap: true,
        strict: true,
        plugins: [
            replace({
                'process.env.NODE_ENV': JSON.stringify('production')
            }),
            RollupPluginAlias({
                assert: 'node_modules/nanoassert/index.js'
            }),
            nodeResolve({ browser: true, jsnext: true, preferBuiltins: false }),
            RollupPluginCommonJS(),
            RollupPluginHtml(),
            RollupPluginSass({
                insert: true,
                include: '**/*.scss',
                exclude: [],
                options: { includePaths: ['node_modules/'] }
            }),
            babel({
                exclude: 'node_modules/**',
                babelrc: false,
                presets: ["@babel/preset-env"],
                plugins: []
            })
        ]
    };


    /**
     *
     * @param {function():ReadableStream} func
     * @returns {Function}
     */
    function debounce(func) {
        let lock = false;
        let pending = false;


        function finalizeExec() {
            //stream ended, clear the flag
            lock = false;
            if (pending) {
                //another request is pending, reset the flag
                pending = false;
                //execute the task again
                exec();
            }
        }

        function exec() {
            //set lock flag
            lock = true;
            func().then(finalizeExec, finalizeExec)
        }

        return function () {
            if (lock) {
                pending = true;
            } else {
                exec();
            }
        }

    }

    function build() {
        console.log('Build started');

        const time = Date.now();

        return new Promise(function (resolve, reject) {

            rollup(config)
                .on('error', function (error) {
                    console.error(error);
                    reject(error);
                })
                .on('bundle', function (bundle) {
                    //patch bundle into the rollup config, to facilitate incremental builds
                    //see https://github.com/Permutatrix/rollup-stream
                    //see https://rollupjs.org/guide/en#big-list-of-options
                    config.cache = bundle;
                })
                //specify the name for the bundled file
                .pipe(VinylSourceStream(name))
                //write out the files
                .pipe(VinylFS.dest(destination))
                .on('end', function () {
                    //recording build time
                    console.log(`Build took ${Date.now() - time}ms`);
                    resolve();
                });

        });
    }

    const debouncedBuild = debounce(build);

    function fileAdded(event) {
        console.log('file added', event);
        debouncedBuild();
    }

    function fileRemoved(event) {
        console.log('file unlinked', event);
        debouncedBuild();
    }

    function fileChanged(event) {
        console.log('file changed', event);
        debouncedBuild();
    }

    debouncedBuild();

    return watch('app/src/**/*.js')
        .on('add', fileAdded)
        .on('change', fileChanged)
        .on('unlink', fileRemoved);
}

function getVarArg(name) {
    let option, i = process.argv.indexOf("--" + name);
    if (i > -1) {
        option = process.argv[i + 1];
        return option;
    } else {
        return null;
    }
}

/**
 *
 * @param {String} opName
 * @param {String} opEntry
 * @returns {*}
 */
function buildDevTool(opName, opEntry) {
//make a folder and an index file
    let indexHTML = [
        '<!DOCTYPE html>',
        '            <html>',
        '            <head>',
        '            <meta http-equiv="cache-control" content="max-age=0" />',
        '            <meta http-equiv="cache-control" content="no-cache" />',
        '            <meta http-equiv="expires" content="0" />',
        '            <meta http-equiv="expires" content="Tue, 01 Jan 1980 1:00:00 GMT" />',
        '            <meta http-equiv="pragma" content="no-cache" />',
        '            <title>Tool ' + opName + '</title>',
        '            </head>',
        '            <body>',
        '            <script src="bundle.js"></script>',
        '            </body>',
        '            </html>'
    ].join('\n');

    const destFolder = './tools/' + opName;
    require('fs').writeFileSync(destFolder + '/index.html', indexHTML);
    return makeWatchBundler('bundle.js', './app/src/' + opEntry, destFolder);
}

gulp.task('build-tool', function () {
    const opEntry = getVarArg('entry');
    const opName = getVarArg('name');
    if (opEntry === null) {
        notifier.notify({ title: "Failed to build tool", message: "Missing argument --entry" });
    } else if (opName === null) {
        notifier.notify({ title: "Failed to build tool", message: "Missing argument --name" });

    } else {
        return buildDevTool(opName, opEntry);
    }
});

let watchSettings = { interval: 500, delay: 100 };

gulp.task('watch-styles', gulp.parallel(
    () => {
        return gulp.watch(sassGlob, watchSettings, gulp.parallel('css'));
    },
    () => {
        //css
        return gulp.watch(styleGlob, watchSettings, gulp.parallel('css'));
    }
));

gulp.task('watch',
    gulp.parallel(
        'watch-styles',
        'copy-data-watch',
        'watch::localization',
        () => {
            return makeWatchBundler('bundle.js', 'app/src/main.js', './public', "./app/src");
        }
    )
);

gulp.task('prototype',
    gulp.parallel(
        'server',
        'html',
        'watch-styles',
        'watch::localization',
        'copy-data-watch',
        () => {
            return makeWatchBundler('bundle.js', 'app/src/test/testFogOfWar.js', './public', "./app/src");
        }
    )
);

gulp.task('release-build-worker-terrain', function () {
    return makeReleaseBundler('bundle-1.js', './app/src/model/level/terrain/tiles/TileBuildWorker.js', './public');
});

gulp.task('release-build-worker-terrain-debug', function () {
    return makeWatchBundler('bundle-1.js', './app/src/model/level/terrain/tiles/TileBuildWorker.js', './public');
});

gulp.task('build-animation-viewer', function () {
    return buildDevTool('AnimationViewer', 'dev/AnimationViewer.js');
});

gulp.task('default', gulp.series(
    gulp.parallel(
        'copy-data',
        'html',
        'css',
        'lib'
    ),
    gulp.parallel('server', 'watch')
));
