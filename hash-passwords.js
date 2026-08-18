const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

async function hashExistingPasswords() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'Kopal@16466',
        database: 'authenticate'
    });

    
    const users = [
        { id: 4, password: 'admin123' },
        { id: 5, password: 'maulik123' },
        { id: 6, password: '1234' },
        { id: 7, password: '1234' },
        { id: 8, password: 'Aryan123' }
    ];

    for (const user of users) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        
        await connection.query(
            'UPDATE employee SET password = ? WHERE id = ?',
            [hashedPassword, user.id]
        );
        
        console.log(`✅ Updated user ID ${user.id}`);
    }

    console.log('✅ All passwords hashed!');
    await connection.end();
}

hashExistingPasswords();