import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fork } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

app.use('/scripts', express.static(path.join(__dirname, 'scripts')));
app.use('/projects', express.static(path.join(__dirname, 'projects')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let scrapingProcess = null;
let isCancelled = false;

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);
const rmdir = promisify(fs.rmdir);

const formatSize = (size) => {
    if (size < 1024) return `${size} B`;
    const i = Math.floor(Math.log(size) / Math.log(1024));
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    return `${(size / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
};

const countFilesAndDirectories = async (dir) => {
    let fileCount = 0;
    let dirCount = 0;
    let totalSize = 0;

    const walk = async (dir) => {
        try {
            const files = await readdir(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const fileStat = await stat(fullPath);
                if (fileStat.isDirectory()) {
                    dirCount++;
                    await walk(fullPath);
                } else {
                    fileCount++;
                    totalSize += fileStat.size;
                }
            }
        } catch (err) {
            console.error(`[Error] Failed to count files and directories: ${err.message}`);
        }
    };

    await walk(dir);
    return { fileCount, dirCount, totalSize: formatSize(totalSize) };
};

const deleteDirectory = async (dir) => {
    try {
        if (!fs.existsSync(dir)) return;
        const files = await readdir(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const fileStat = await stat(fullPath);
            if (fileStat.isDirectory()) {
                await deleteDirectory(fullPath);
            } else {
                await unlink(fullPath);
            }
        }
        await rmdir(dir);
    } catch (err) {
        console.error(`[Error] Failed to delete directory: ${err.message}`);
    }
};

io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('startDownload', async (data) => {
        const { websiteUrl, directoryName, selectedFileTypes, maxDepth, maxRecursive, recursive } = data;
        if (!websiteUrl || !directoryName) {
            socket.emit('log', { message: '<span style="color: red;">[Error]</span> URL and Directory Name are required.' });
            return;
        }
        console.log(`\nStarting download...`)
        socket.emit('log', { message: 'Starting download...\n\n<span style="color: yellow;">[Attention]</span> This process may take time, Please wait.' });

        const downloadDir = path.join(__dirname, 'projects', directoryName);

        if (fs.existsSync(downloadDir)) {
            socket.emit('log', { message: `<span style="color: yellow;">[Warning]</span> Directory "${directoryName}" already exists. Deleting...` });
            console.log(`[Warning] Directory "${directoryName}" already exists. Deleting...`);
            await deleteDirectory(downloadDir);
        }

        isCancelled = false;

        try {
            scrapingProcess = fork(path.join(__dirname, 'scripts', 'scraperProcess.js'));

            scrapingProcess.send({ websiteUrl, directoryName, selectedFileTypes, maxDepth, maxRecursive, recursive, downloadDir });

            scrapingProcess.on('message', async (msg) => {
                if (msg.type === 'log') {
                    socket.emit('log', { message: msg.payload });
                } else if (msg.type === 'downloadReady') {
                    // socket.emit('log', { message: `- Archive <span style="color: mediumspringgreen;">"${msg.payload.directoryName}.zip"</span> ready for download.` });
                    socket.emit('downloadReady', `/projects/${directoryName}.zip`);
                } else if (msg.type === 'treeDirectory') {
                    try {
                        const { fileCount, dirCount, totalSize } = await countFilesAndDirectories(downloadDir);
                        socket.emit('log', { message: '<span style="color: mediumspringgreen;">[Done]</span> The website has been downloaded successfully!' });
                        console.log(`[Done] The website has been downloaded successfully!`);
                        socket.emit('log', { message: '<span style="color: #00fa3b;">\n$</span> <span style="color: white;">Directory Tree:</span> ' + `<u>${directoryName}</u>` });
                        socket.emit('log', { message: `<pre>${msg.payload}</pre>` });
                        socket.emit('log', { message: `- Directories: <span style="color: #00fa3b;"><b>${dirCount}</b></span>, Files: <span style="color: #00fa3b;"><b>${fileCount}</b></span>, Total Size: <mark style="background-color: #5facf8;"><span style="color: black;"><b>${totalSize}</b></span></mark>` });
                    } catch (error) {
                        socket.emit('log', { message: `<span style="color: red;">[Error]</span> ${error.message}` });
                    }
                }
            });

            scrapingProcess.on('error', (err) => {
                console.error(`[Error] Scraping process encountered an error: ${err.message}`);
                socket.emit('log', { message: `<span style="color: red;">[Error]</span> Scraping process encountered an error: ${err.message}` });
                scrapingProcess = null;
            });

            scrapingProcess.on('exit', () => {
                if (!isCancelled) {
                    socket.emit('log', { message: '<span style="color: purple;">$</span> <span style="color: white;">Enjoy Your Day :)</span>' });
                }
                scrapingProcess = null;
            });
        } catch (error) {
            console.error(`[Error] Failed to start scraping process: ${error.message}`);
            socket.emit('log', { message: `<span style="color: red;">[Error]</span> Failed to start scraping process: ${error.message}` });
        }
    });

    socket.on('cancelDownload', () => {
        if (scrapingProcess) {
            isCancelled = true;
            scrapingProcess.kill();
            socket.emit('log', { message: '<span style="color: red;">[Cancel]</span> Download cancellation initiated by user.' });
            console.log(`[Cancel] Download cancellation initiated by user.`);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

httpServer.listen(3000, () => {
    console.log('Server is listening on port 3000');
});
