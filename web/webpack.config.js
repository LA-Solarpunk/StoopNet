import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import MinimizerPlugin from 'minimizer-webpack-plugin';
import fs from 'fs';
import { SizeBudgetPlugin } from './scripts/size-budget-plugin.js';
import { MarkdownPagesPlugin } from './scripts/markdown-pages-plugin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load environment variables from .env file.
 * This allows users to customize build behavior without modifying
 * the webpack config directly.
 */
dotenv.config();

const outputFileName = process.env.OUTPUT_FILE_NAME || 'index.js';
const port = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Size budget for the output folder, in MiB. The build warns above the
 * warn limit and fails above the error limit (1 MiB = 1024 * 1024 bytes,
 * matching how firmware partitions are sized).
 */
const mibFromEnv = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 1024 * 1024)
    : fallback;
};
const sizeWarnBytes = mibFromEnv(process.env.SIZE_WARN_MB, 2 * 1024 * 1024);
const sizeErrorBytes = mibFromEnv(process.env.SIZE_ERROR_MB, 3 * 1024 * 1024);

/**
 * Check if assets directory exists and has files.
 * We only add CopyWebpackPlugin if there are actual assets to copy,
 * avoiding unnecessary build overhead for projects without static files.
 */
const assetsPath = path.join(__dirname, 'assets');
const hasAssets = (() => {
  try {
    return fs.existsSync(assetsPath) && fs.readdirSync(assetsPath).length > 0;
  } catch {
    return false;
  }
})();

/**
 * Webpack Configuration
 *
 * Production builds emit exactly three files into dist/:
 *   - index.html  (generated from the template, links the other two)
 *   - index.js    (all JavaScript, minified)
 *   - index.css   (all styles, extracted from the bundle)
 *
 * The SizeBudgetPlugin enforces the distribution size budget: warn above
 * SIZE_WARN_MB (default 2 MiB), fail the build above SIZE_ERROR_MB
 * (default 3 MiB).
 */
export default {
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: isDev ? '[name].js' : outputFileName,
    clean: true,
    /**
     * A predictable public path so that runtime asset URLs resolve
     * relative to the site root.
     */
    publicPath: '/',
  },
  mode: isDev ? 'development' : 'production',
  devServer: {
    static: {
      directory: path.join(__dirname, 'assets'),
      publicPath: '/',
    },
    port: port,
    hot: true,
    open: false,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        /**
         * Development injects styles via JS (style-loader); production
         * extracts them to a real index.css file so the output is three
         * plain files a static server can serve as-is.
         */
        use: [
          isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              /**
               * Root-relative URLs (e.g. url('/font.ttf')) are left for the
               * browser to resolve against the site root; otherwise css-loader
               * tries to find them on the filesystem and the build fails.
               */
              url: {
                filter: (url) => !url.startsWith('/'),
              },
              ...(isDev ? {} : {
                importLoaders: 1,
                modules: false,
              }),
            }
          },
          {
            loader: 'postcss-loader',
            options: isDev ? {} : {
              postcssOptions: {
                plugins: [
                  ['cssnano', {
                    preset: ['default', {
                      discardComments: {
                        removeAll: true,
                      },
                    }],
                  }],
                ],
              },
            }
          }
        ],
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: path.resolve(__dirname, 'scripts/transform-workers.js'),
          },
          {
            loader: 'swc-loader',
            options: {
              jsc: {
                parser: {
                  syntax: 'ecmascript',
                },
                target: 'es2015',
              },
            },
          },
        ],
      },
    ],
  },
  optimization: {
    splitChunks: false,
    runtimeChunk: isDev ? 'single' : false,
    ...(isDev ? {} : {
      /**
       * Minimizer tuning for the smallest possible distribution: an extra
       * compress pass shaves a few more percent off the bundle, and legal
       * comments are dropped instead of being extracted to a separate
       * LICENSE.txt file (which would break the three-file output).
       */
      minimizer: [new MinimizerPlugin({
        minify: MinimizerPlugin.terserMinify,
        terserOptions: {
          compress: {
            passes: 2,
          },
        },
        extractComments: false,
      })],
    }),
  },
  /**
   * Webpack's default performance hints (warnings above 244 KB per asset)
   * would fire on every build; the SizeBudgetPlugin is the authoritative
   * size check, so silence the built-in noise.
   */
  performance: {
    hints: false,
  },
  resolve: {
    extensions: ['.js', '.json'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
    }),
    /**
     * Compile md/*.md into dist/*.html pages that link index.css/index.js.
     * Runs in development too, so the dev server serves the pages.
     */
    new MarkdownPagesPlugin({
      context: path.join(__dirname, 'md'),
    }),
    ...(isDev ? [] : [new MiniCssExtractPlugin({
      filename: 'index.css',
    })]),
    ...(hasAssets
      ? [
          new CopyWebpackPlugin({
            patterns: [
              {
                from: 'assets',
                to: '.',
              },
            ],
          }),
        ]
      : []),
    /**
     * Size budget: warn when the output folder exceeds SIZE_WARN_MB and
     * fail the build when it exceeds SIZE_ERROR_MB (defaults: 2 MiB / 3 MiB).
     */
    ...(!isDev ? [new SizeBudgetPlugin({
      warnBytes: sizeWarnBytes,
      errorBytes: sizeErrorBytes,
    })] : []),
  ],
};
