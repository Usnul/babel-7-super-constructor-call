
const babel = require('rollup-plugin-babel');
const nodeResolve = require('rollup-plugin-node-resolve');
import commonjs from 'rollup-plugin-commonjs';
import html from 'rollup-plugin-html';
import sass from 'rollup-plugin-sass';
import alias from 'rollup-plugin-alias';

const unassert = require('rollup-plugin-unassert');

const replace = require('rollup-plugin-replace');

const outputFile = './public/bundle.js';
const outputFormat = 'iife';

const config = {
    input: './app/src/main.js',
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
        nodeResolve({browser: true, jsnext: true}),
        commonjs(),
        html(),
        sass({
            insert: true,
            include: '**/*.scss',
            exclude: [],
            options: {includePaths: ['node_modules/']}
        }),
        unassert(),
        babel({
            exclude: 'node_modules/**',
            babelrc: false,
            presets: ["@babel/env"],
            plugins: ["@babel/plugin-external-helpers"]
        })
    ]
};

export default config;