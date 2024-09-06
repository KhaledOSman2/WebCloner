import scrape from 'website-scraper';
import PuppeteerPlugin from 'website-scraper-puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const formatSize = (size) => {
    if (size < 1024) return `${size} B`;
    const i = Math.floor(Math.log(size) / Math.log(1024));
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    return `${(size / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
};

const getDirectoryTree = async (dir) => {
    let tree = '';
    const walk = async (dir, prefix = '') => {
        try {
            const files = await fs.promises.readdir(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = await fs.promises.stat(fullPath);
                tree += `${prefix}├── ${file} <span style="color: cornflowerblue;">(${formatSize(stat.size)})</span>\n`;
                if (stat.isDirectory()) {
                    await walk(fullPath, prefix + '│   ');
                }
            }
        } catch (err) {
            console.error(`[Error] Failed to get directory tree: ${err.message}`);
            process.send({ type: 'log', payload: `<span style="color: red;">[Error]</span> Failed to get directory tree: ${err.message}` });
        }
    };
    await walk(dir);
    return tree;
};

const createArchive = async (dir, archivePath) => {
    const archiveDir = path.dirname(archivePath);
    if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(archivePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve(archivePath));
        archive.on('error', (err) => {
            console.error(`[Error] Failed to create archive: ${err.message}`);
            reject(err);
        });

        archive.pipe(output);
        archive.directory(dir, false);
        archive.finalize();
    });
};

const filterFiles = async (directory, selectedFileTypes) => {
    const extensions = {
        html: ['.html', '.htm'],
        css: ['.css'],
        js: ['.js'],
        images: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.bmp'],
        media: ['.mp4', '.mp3'],
    };

    const walk = async (dir) => {
        try {
            const files = await fs.promises.readdir(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = await fs.promises.stat(fullPath);
                if (stat.isFile()) {
                    const fileExtension = path.extname(file);
                    const keepFile = selectedFileTypes.some(type => extensions[type].includes(fileExtension));

                    if (keepFile) {
                        await fs.promises.unlink(fullPath);
                        console.log(`[+] Deleted file: ${fullPath}`);
                    }
                } else if (stat.isDirectory()) {
                    await walk(fullPath);
                }
            }
        } catch (err) {
            console.error(`[Error] Failed to filter files: ${err.message}`);
            process.send({ type: 'log', payload: `<span style="color: red;">[Error]</span> Failed to filter files: ${err.message}` });
        }
    };

    await walk(directory);
};

class MyPlugin {
    apply(registerAction) {
        registerAction('error', async ({ error }) => {
            const message = `[Error] ${error.message}`;
            process.send({ type: 'log', payload: `<span style="color: red;">${message}</span>` });
            console.error(message);
        });

        registerAction('onResourceSaved', ({ resource }) => {
            const message = `[Success] Resource saved successfully: ${resource.filename}`;
            console.log(message);
        });

        registerAction('onResourceError', ({ resource, error }) => {
            const message = `[Error] Resource error: ${resource.url} - Error details: ${error.message}`;
            process.send({ type: 'log', payload: `<span style="color: orange;">${message}</span>` });
            console.error(message);
        });
    }
}

process.on('message', async (data) => {
    const { websiteUrl, directoryName, selectedFileTypes, maxDepth, maxRecursive, downloadDir, recursive } = data;

    const scrapeOptions = {
        urls: [websiteUrl],
        urlFilter: (url) => url.indexOf(websiteUrl) === 0,
        directory: downloadDir,
        maxDepth: maxDepth || 10,
        recursive: recursive,
        maxRecursiveDepth: maxRecursive,
        prettifyUrls: true,
        maxConcurrency: 5,
        ignoreErrors: true,
        timeout: 60000,
        requestInterval: 1000,
        plugins: [
            new PuppeteerPlugin({
                launchOptions: { headless: true },
                puppeteer,
                scrollToBottom: { timeout: 120000, viewportN: 10 },
                blockNavigation: true,
                useChrome: true,
                navigationOptions: { timeout: 120000 },
                gotoOptions: { timeout: 120000 }
            }),
            new MyPlugin()
        ],
    };

    try {
        process.send({ type: 'log', payload: '<span style="color: mediumspringgreen;">[Scraping]</span> Website scraping in progress...' });
        await scrape(scrapeOptions);

        if (selectedFileTypes && selectedFileTypes.length > 0) {
            await filterFiles(downloadDir, selectedFileTypes);
        }

        const tree = await getDirectoryTree(downloadDir);
        process.send({ type: 'treeDirectory', payload: tree });

        const archivePath = path.join(__dirname, '..', 'projects', `${directoryName}.zip`);
        await createArchive(downloadDir, archivePath);
        process.send({ type: 'log', payload: `- Max Depth: <span style="color: #00fa3b;"><b>${maxDepth}</b></span>, MaxRecursive: <span style="color: #00fa3b;"><b>${maxRecursive}</b></span>, Recursive: <span style="color: ${recursive ? '#00fa3b' : '#FF0000'};"><b>${recursive}</b></span>` });
        process.send({ type: 'downloadReady', payload: { directoryName, downloadLink: `projects/${directoryName}.zip` } });

    } catch (err) {
        process.send({ type: 'log', payload: `<span style="color: red;">[Error]</span> An error occurred during scraping: ${err.message}. Please check the logs for more details.` });
        console.log(`[Error] ${err.message}`);
    } finally {
        process.exit();
    }
});
