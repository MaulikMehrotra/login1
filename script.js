require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require("nodemailer");
const Sentiment = require('sentiment');
const sentiment = new Sentiment();
const bcrypt = require('bcrypt');
const app = express();
const path = require("path");
const { body, validationResult } = require('express-validator');  // ← ADD THIS
app.use(express.static(path.join(__dirname)));
app.use(cors());
app.use(express.json());

// reCAPTCHA test secret
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;

// DB CONNECTION

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


db.connect(err => {
    if (err) {
        console.error("❌ DB connection failed:", err);
        process.exit(1);
    }
    console.log("✅ MySQL connected");
});








app.post('/login', async (req, res) => {
    const { pensioncode, password, captcha } = req.body;

    if (!pensioncode || !password) {
        return res.status(400).json({ message: "Missing fields" });
    }

    if (!captcha) {
        return res.status(400).json({ message: "Complete CAPTCHA" });
    }

    try {
        const verify = await axios.post(
            'https://www.google.com/recaptcha/api/siteverify',
            null,
            { params: { secret: RECAPTCHA_SECRET, response: captcha } }
        );

        if (!verify.data.success) {
            return res.status(400).json({ message: "CAPTCHA failed" });
        }
    } catch (err) {
        return res.status(500).json({ message: "CAPTCHA error" });
    }

    // NEW: Get user with password included
    const sql = `
        SELECT pensioncode, employee_name, role, password
        FROM employee
        WHERE pensioncode = ?
    `;

    db.query(sql, [pensioncode], async (err, rows) => {

        if (err) {
            console.error(err);
            return res.status(500).json({ message: "DB error" });
        }

        if (rows.length === 0) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // NEW: Compare hashed password
        try {
            const validPassword = await bcrypt.compare(password, rows[0].password);
            
            if (!validPassword) {
                return res.status(401).json({ message: "Invalid credentials" });
            }

            // Remove password from response
            const user = {
                pensioncode: rows[0].pensioncode,
                employee_name: rows[0].employee_name,
                role: rows[0].role
            };

            res.json({
                message: "Login successful",
                user: user
            });

        } catch (bcryptErr) {
            console.error("Bcrypt error:", bcryptErr);
            return res.status(500).json({ message: "Authentication error" });
        }
    });
});

// ================= GET USER DETAILS =================
app.get('/user/:pensioncode', (req, res) => {
    const { pensioncode } = req.params;

    const sql = `
        SELECT pensioncode, employee_name, mobile, designation_id,
               dob, dor, address, basic_pension, dearness_allowance
        FROM employee
        WHERE pensioncode = ?
    `;

    db.query(sql, [pensioncode], (err, rows) => {
        if (err) {
            console.error("❌ Fetch user error:", err);
            return res.status(500).json({ message: "DB error" });
        }

        if (rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json(rows[0]);
    });
});

// ================= SAVE FEEDBACK =================
app.post('/feedback', (req, res) => {

    const { pensioncode, token, message } = req.body;

    if (!pensioncode || !message) {
        return res.status(400).json({ message: "Missing fields" });
    }

    // 🔥 SENTIMENT ANALYSIS
    const result = sentiment.analyze(message);

    let sentimentLabel = "NEUTRAL";

    if (result.score > 0) sentimentLabel = "POSITIVE";
    else if (result.score < 0) sentimentLabel = "NEGATIVE";

    const sql = `
        INSERT INTO feedback (pensioncode, token_number, message, sentiment)
        VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [pensioncode, token, message, sentimentLabel], (err, result) => {

        if (err) {
            console.error("❌ Feedback insert error:", err);
            return res.status(500).json({ message: "Feedback failed" });
        }

        res.json({
            message: "Feedback submitted",
            sentiment: sentimentLabel   // 👈 return to frontend
        });
    });
});
app.get("/feedback-stats", (req, res) => {

    const sql = `
        SELECT sentiment, COUNT(*) as count
        FROM feedback
        GROUP BY sentiment
    `;

    db.query(sql, (err, rows) => {

        if (err) {
            console.error(err);
            return res.status(500).json({ message: "DB error" });
        }

        res.json(rows);
    });
});

// ================= REGISTER ================= 
app.post('/register', async (req, res) => {
    const {
        pensioncode,
        employee_name,
        password,
        payroll_type,
        category,
        designation_id,
        pan_number,
        bank_name,
        account_number,
        mobile,
        dob,
        gender,
        email,
        doj,
        dor,
        address,
        basic_pension,
        dearness_allowance
    } = req.body;

    if (!pensioncode || !password || !employee_name) {
        return res.status(400).json({ message: "Required fields missing" });
    }

    const checkSql = `SELECT id FROM employee WHERE pensioncode = ?`;

    db.query(checkSql, [pensioncode], async (err, rows) => {
        if (rows.length > 0) {
            return res.status(409).json({ message: "User already exists" });
        }

       // Hash password before saving
        const hashedPassword = await bcrypt.hash(password, 10);

        const insertSql = `
            INSERT INTO employee
            (pensioncode, employee_name, password, payroll_type, category,
             designation_id, pan_number, bank_name, account_number,
             mobile, dob, gender, email, doj, dor,address,basic_pension,dearness_allowance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(insertSql, [
            pensioncode,
            employee_name,
            hashedPassword,  // ← Use hashed password
            payroll_type,
            category,
            designation_id,
            pan_number,
            bank_name,
            account_number,
            mobile,
            dob,
            gender,
            email,
            doj,
            dor,
            address,
            basic_pension,
            dearness_allowance
        ], err => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Registration failed" });
            }

            res.json({ message: "Registration successful" });
        });
    });
});


app.post('/tickets', (req, res) => {
    const {
        pensioncode,
        category,
        assigned_to,
        description
    } = req.body;

    if (!pensioncode || !description) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    const sql = `
        INSERT INTO tickets (pensioncode, category, assigned_to, description, status)
    VALUES (?, ?, ?, ?, 'PENDING')
    `;

    db.query(sql,
        [pensioncode, category, assigned_to, description],
        (err, result) => {

            if (err) {
                console.error("❌ Ticket insert error:", err);
                return res.status(500).json({ message: "Ticket creation failed" });
            }

            res.json({
                message: "Ticket created successfully",
                ticket_id: result.insertId
            });
        }
    );
});

app.get('/tickets/:role', (req, res) => {

    const role = req.params.role;

    const sql = `
        SELECT ticket_id, pensioncode, category, status, assigned_to
        FROM tickets
        WHERE assigned_to = ?
        ORDER BY created_at DESC
    `;

    db.query(sql, [role], (err, rows) => {
        if (err) return res.status(500).json({ message: "DB error" });
        res.json(rows);
    });
});

app.get('/ticket/:id', (req, res) => {

    const ticketId = req.params.id;

    const sql = `
        SELECT t.*, e.employee_name, e.mobile, e.designation_id,
               e.dob, e.dor, e.address,
               e.basic_pension, e.dearness_allowance
        FROM tickets t
        JOIN employee e ON t.pensioncode = e.pensioncode
        WHERE t.ticket_id = ?
    `;

    db.query(sql, [ticketId], (err, rows) => {

        if (err) {
            console.error(err);
            return res.status(500).json({ message: "DB error" });
        }

        if (rows.length === 0) {
            return res.status(404).json({ message: "Ticket not found" });
        }

        res.json(rows[0]);
    });
});



// ================= CHECK TICKET STATUS =================
app.get('/ticket-status/:id', (req, res) => {

    const ticketId = req.params.id;

    const sql = `
        SELECT ticket_id, pensioncode, category, assigned_to,
               description, status, created_at
        FROM tickets
        WHERE ticket_id = ?
    `;

    db.query(sql, [ticketId], (err, rows) => {

        if (err) {
            console.error(err);
            return res.status(500).json({ message: "DB error" });
        }

        if (rows.length === 0) {
            return res.status(404).json({ message: "Ticket not found" });
        }

        res.json(rows[0]);
    });
});

app.get("/user-tickets/:pensioncode", (req, res) => {

    const { pensioncode } = req.params;

    const sql = `
        SELECT ticket_id, category, status, created_at
        FROM tickets
        WHERE pensioncode = ?
        ORDER BY created_at DESC
    `;

    db.query(sql, [pensioncode], (err, rows) => {

        if (err) {
            console.error(err);
            return res.status(500).json({ message: "DB error" });
        }

        res.json(rows);
    });
});


// SAVE MESSAGE
app.post("/messages", (req, res) => {

    const { pensioncode, ticket_id, message } = req.body;

    const sql = `
        INSERT INTO messages (pensioncode, ticket_id, message)
        VALUES (?, ?, ?)
    `;

    db.query(sql, [pensioncode, ticket_id, message], (err, result) => {

        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Message failed" });
        }

        // Get user email and send notification
        const userSql = `SELECT email, employee_name FROM employee WHERE pensioncode = ?`;
        
        db.query(userSql, [pensioncode], async (err, rows) => {
            if (!err && rows.length > 0 && rows[0].email) {
                
                const userName = rows[0].employee_name;
                const userEmail = rows[0].email;

                // Send email notification
                try {
                    await transporter.sendMail({
                        from: `"Pension Grievance Redressal System" <${process.env.EMAIL_USER}>`,
                        to: userEmail,
                        subject: `Update on Your Ticket #${ticket_id}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
                                <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 20px; border-radius: 10px;">
                                    <h2 style="color: #054379;">Pension Grievance Redressal System - Ticket Update</h2>
                                    <p>Dear <strong>${userName}</strong>,</p>
                                    <p>There's a new update on your ticket <strong>#${ticket_id}</strong>:</p>
                                    <div style="background-color: #e8f4ff; padding: 15px; border-left: 4px solid #054379; margin: 20px 0;">
                                        <p style="margin: 0; color: #333;">${message}</p>
                                    </div>
                                    <p>Please login to your account to view full details and respond if needed.</p>
                                    <p style="margin-top: 30px; color: #666; font-size: 12px;">
                                        This is an automated message from Pension Grievance Redressal System.
                                    </p>
                                </div>
                            </div>
                        `
                    });
                    console.log(`✅ Email sent to ${userEmail}`);
                } catch (emailErr) {
                    console.error("❌ Email failed:", emailErr);
                    // Don't fail the request if email fails
                }
            } else {
                console.log("⚠️ No email found for pensioncode:", pensioncode);
            }
        });

        res.json({ message: "Message sent" });
    });
});

app.put("/tickets/:id/status", (req, res) => {

    const ticketId = req.params.id;
    const { status } = req.body;

    const sql = `
        UPDATE tickets SET status = ?
        WHERE ticket_id = ?
    `;

    db.query(sql, [status, ticketId], (err) => {

        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Update failed" });
        }

        res.json({ message: "Status updated" });
    });
});

app.get("/messages/:ticket_id", (req, res) => {

    const { ticket_id } = req.params;

    const sql = `
        SELECT * FROM messages
        WHERE ticket_id = ?
        ORDER BY created_at ASC
    `;

    db.query(sql, [ticket_id], (err, rows) => {

        if (err) {
            console.error(err);
            return res.status(500).json({ message: "DB error" });
        }

        res.json(rows);
    });
});

// START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
