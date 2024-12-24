require('dotenv').config(); // Load environment variables

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const ytdl = require('youtube-dl-exec').create('./node_modules/.bin/yt-dlp'); // Use the binary path explicitly
const fs = require('fs');
const { readFile } = require('fs/promises');

// YouTube API Key and Base URL
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; // Use environment variable
const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3/search';

// Function to search for music on YouTube
const searchMusicOnYouTube = async (query) => {
    try {
        const response = await axios.get(YOUTUBE_API_URL, {
            params: {
                q: query,
                part: 'snippet',
                type: 'video',
                maxResults: 1,
                key: YOUTUBE_API_KEY,
            },
        });
        const video = response.data.items[0];
        if (video) {
            return `https://www.youtube.com/watch?v=${video.id.videoId}`;
        } else {
            return null;
        }
    } catch (error) {
        console.error('Error searching music:', error);
        return null;
    }
};

// Function to download MP3 from YouTube
const downloadMusicAsMP3 = async (url, outputPath) => {
    try {
        await ytdl(url, {
            output: outputPath,
            extractAudio: true,
            audioFormat: 'mp3',
        });
        console.log(`Downloaded: ${outputPath}`);
        return outputPath;
    } catch (error) {
        console.error('Error downloading MP3:', error);
        console.error('stderr:', error.stderr);
        console.error('stdout:', error.stdout);
        throw error;
    }
};

// Function to start the WhatsApp bot
const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('./auth');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Connection closed. Reason: ${reason}`);
            if (reason !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                startSock();
            } else {
                console.log('Logged out. Delete the "auth" folder and restart to scan QR code.');
            }
        } else if (connection === 'open') {
            console.log('WhatsApp connection is open.');
        }
    });

    sock.ev.on('messages.upsert', async (msg) => {
        const message = msg.messages[0];
        if (!message.key.fromMe && message.message) {
            const sender = message.key.remoteJid;
            const text =
                message.message.conversation ||
                message.message.extendedTextMessage?.text ||
                message.message.ephemeralMessage?.message?.extendedTextMessage?.text ||
                '';

            console.log(`Message from ${sender}: ${text}`);

            if (text.startsWith('search music')) {
                const musicQuery = text.replace('search music', '').trim();
                const videoUrl = await searchMusicOnYouTube(musicQuery);

                if (videoUrl) {
                    const outputPath = './temp.mp3';
                    try {
                        await downloadMusicAsMP3(videoUrl, outputPath);

                        // Send the audio file
                        console.log('Sending audio to WhatsApp...');
                        const audioBuffer = await readFile(outputPath);
                        await sock.sendMessage(sender, {
                            audio: audioBuffer,
                            mimetype: 'audio/mpeg',
                        });

                        console.log('Audio sent successfully!');
                        fs.unlinkSync(outputPath); // Clean up the file
                    } catch (error) {
                        console.error('Error downloading or sending MP3:', error);
                        await sock.sendMessage(sender, { text: 'Sorry, I could not download or send the music.' });
                    }
                } else {
                    await sock.sendMessage(sender, { text: 'No music found for your query.' });
                }
            }
        }
    });

    return sock;
};

// Start the WhatsApp bot
startSock().catch((err) => console.error('Error starting the bot:', err));
