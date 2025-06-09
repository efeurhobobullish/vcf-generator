require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Telegraf } = require('telegraf');
const path = require('path');
const crypto = require('crypto'); // Replaced shortid
const app = express();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI 'mongodb+srv://empirepayvtu:empirevtu1@empirepayvtu.mygpq.mongodb.net/?retryWrites=true&w=majority&appName=empirepayvtu', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Database models
const Session = mongoose.model('Session', new mongoose.Schema({
    sessionId: { type: String, unique: true },
    name: String,
    duration: Number,
    expiresAt: Date,
    contacts: [{
        fullName: String,
        phone: String,
        addedAt: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    notified: { type: Boolean, default: false }
}));

// Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.post('/api/sessions', async (req, res) => {
    try {
        const { name, duration } = req.body;

        // Calculate expiration time (duration is in minutes)
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + duration);

        const session = new Session({
            sessionId: crypto.randomBytes(8).toString('hex'), // Replaced shortid
            name,
            duration,
            expiresAt
        });

        await session.save();

        res.json({
            sessionId: session.sessionId,
            name: session.name,
            duration: session.duration,
            expiresAt: session.expiresAt
        });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ error: 'Failed to create session' });
    }
});

app.get('/api/sessions/:sessionId', async (req, res) => {
    try {
        const session = await Session.findOne({ sessionId: req.params.sessionId });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (new Date() > session.expiresAt) {
            return res.status(410).json({ error: 'Session expired' });
        }

        res.json({
            name: session.name,
            duration: session.duration,
            expiresAt: session.expiresAt
        });
    } catch (error) {
        console.error('Error fetching session:', error);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
});

app.post('/api/sessions/:sessionId/contacts', async (req, res) => {
    try {
        const { fullName, phone } = req.body;

        // Validate Nigerian phone number
        if (!/^\+234[0-9]{10}$/.test(phone)) {
            return res.status(400).json({ error: 'Please enter a valid Nigerian phone number starting with +234' });
        }

        const session = await Session.findOne({ sessionId: req.params.sessionId });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (new Date() > session.expiresAt) {
            return res.status(410).json({ error: 'Session expired' });
        }

        session.contacts.push({ fullName, phone });
        await session.save();

        // Send notification to Telegram
        await bot.telegram.sendMessage(
            process.env.TELEGRAM_CHAT_ID,
            `New contact added:\n\nName: ${fullName}\nPhone: ${phone}\n\nFrom session: ${session.name} (Expires: ${session.expiresAt})`
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error adding contact:', error);
        res.status(500).json({ error: 'Failed to add contact' });
    }
});

// Handle expired sessions
setInterval(async () => {
    try {
        const expiredSessions = await Session.find({
            expiresAt: { $lte: new Date() },
            contacts: { $exists: true, $not: { $size: 0 } },
            notified: { $ne: true }
        });

        for (const session of expiredSessions) {
            // Create VCF file content
            let vcfContent = '';
            session.contacts.forEach(contact => {
                vcfContent += `BEGIN:VCARD\n`;
                vcfContent += `VERSION:3.0\n`;
                vcfContent += `FN:${contact.fullName}\n`;
                vcfContent += `TEL;TYPE=CELL:${contact.phone}\n`;
                vcfContent += `REV:${new Date().toISOString()}\n`;
                vcfContent += `END:VCARD\n\n`;
            });

            // Send VCF to Telegram
            await bot.telegram.sendDocument(
                process.env.TELEGRAM_CHAT_ID,
                {
                    source: Buffer.from(vcfContent),
                    filename: `contacts_${session.sessionId}.vcf`
                },
                {
                    caption: `Contacts from session: ${session.name} (${session.sessionId})`
                }
            );

            // Mark as notified
            session.notified = true;
            await session.save();
        }
    } catch (error) {
        console.error('Error processing expired sessions:', error);
    }
}, 60 * 1000); // Check every minute

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Start Telegram bot
    bot.launch().then(() => {
        console.log('Telegram bot started');
    });
});
