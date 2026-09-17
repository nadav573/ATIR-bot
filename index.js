const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');

// מסד נתונים מקומי
const dbPath = './db.json';
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ counts: {}, history: [] }));
}
let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildInvites  
    ]
});

const WELCOME_CHANNEL_ID = '1545134087747014846'; 
const CLIENT_ID = '1548471365978558574';
const TOKEN = 'MTU0ODQ3MTM2NTk3ODU1ODU3NA.GFR0pP.y8uAljnnZybpcZaV7FWKmR0McTyxtx_Yi4qXpM'; 

const ADMIN_IDS = ['1536113241422561322', '1360243153679941683'];

const invites = new Map();

// טעינת ההזמנות כולל שמירת פרטי המזמין בזיכרון (כדי לא לאבד קישורים שנמחקים)
const loadInvites = async (guild) => {
    try {
        const currentInvites = await guild.invites.fetch();
        const codeMap = new Map();
        currentInvites.forEach(inv => {
            codeMap.set(inv.code, { uses: inv.uses, inviter: inv.inviter });
        });
        invites.set(guild.id, codeMap);
    } catch (error) {
        console.log('שגיאה בטעינת הזמנות.');
    }
};

const commands = [
    new SlashCommandBuilder()
        .setName('invite')
        .setDescription('בדיקה כמה הזמנות תקינות יש למשתמש בשרת')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('בחר משתמש')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('resetinvite')
        .setDescription('מאפס הזמנות למשתמשים (למנהלים בלבד)')
        .addSubcommand(subcommand => 
            subcommand.setName('all')
            .setDescription('מאפס את ההזמנות לכל המשתמשים בשרת ל-0')
        )
        .addSubcommand(subcommand => 
            subcommand.setName('user')
            .setDescription('מאפס הזמנות למשתמש ספציפי ל-0')
            .addUserOption(option => 
                option.setName('target')
                .setDescription('בחר את המשתמש שתרצה לאפס לו')
                .setRequired(true)
            )
        )
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`הבוט ${client.user.tag} מחובר!`);
    
    for (const [id, guild] of client.guilds.cache) {
        await loadInvites(guild);
    }

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );
        console.log('פקודות ה- /invite ו- /resetinvite נטענו בהצלחה!');
    } catch (error) {
        console.error(error);
    }
});

client.on('inviteCreate', async (invite) => { if (invite.guild) await loadInvites(invite.guild); });
client.on('inviteDelete', async (invite) => { if (invite.guild) await loadInvites(invite.guild); });

// ==========================================
// אירוע כניסת משתמש (מתוקן 100% לקישורים חד-פעמיים)
// ==========================================
client.on('guildMemberAdd', async (member) => {
    const cachedInvites = invites.get(member.guild.id) || new Map();
    let inviter = null;

    try {
        const newInvites = await member.guild.invites.fetch();
        
        // 1. חיפוש קישור קיים שמספר השימושים שלו גדל
        let usedInvite = newInvites.find(inv => {
            const prev = cachedInvites.get(inv.code);
            return prev && inv.uses > prev.uses;
        });

        if (usedInvite) {
            inviter = usedInvite.inviter;
        } else {
            // 2. פתרון לקישור חד-פעמי: חיפוש קישור שהיה בזיכרון ונמחק ברגע הכניסה!
            const deletedCode = [...cachedInvites.keys()].find(code => !newInvites.has(code));
            if (deletedCode) {
                const deletedData = cachedInvites.get(deletedCode);
                if (deletedData) inviter = deletedData.inviter;
            }
        }

        // עדכון הזיכרון לאחר הבדיקה
        await loadInvites(member.guild); 
    } catch (err) {
        console.log('שגיאה בזיהוי ההזמנה.');
    }

    // בדיקות Anti-Cheat
    const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
    const isAlt = accountAgeDays < 30;
    const hasJoinedBefore = db.history.includes(member.user.id);

    if (inviter && inviter.id !== member.user.id) {
        if (!isAlt && !hasJoinedBefore) {
            db.counts[inviter.id] = (db.counts[inviter.id] || 0) + 1;
        }
        if (!hasJoinedBefore) {
            db.history.push(member.user.id);
        }
        saveDB();
    }

    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!channel) return;

    const totalValidInvites = inviter ? (db.counts[inviter.id] || 0) : 0;

    let descriptionText = `ברוך הבא לשרת ${member}!\n\n`;
    
    if (inviter) {
        descriptionText += `**ותודה ל-** <@${inviter.id}> **שצירפת אותו!** 🎉\n`;
        descriptionText += `כרגע <@${inviter.id}> עומד על **${totalValidInvites}** הזמנות לשרת 🏆`;
    } else {
        descriptionText += `**ותודה למזמין לא ידוע שצירפת אותו!** 🎉\n`;
        descriptionText += `(קישור כללי או מערכת חיפוש)`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
        .setDescription(descriptionText)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setTimestamp();

    channel.send({ embeds: [embed] }).catch(console.error);
});

// פקודות סלאש
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'invite') {
        const targetUser = interaction.options.getUser('user');
        const totalValidUses = db.counts[targetUser.id] || 0;

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📊 סטטיסטיקת הזמנות אישית')
            .setAuthor({ name: targetUser.tag, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
            .setDescription(`כרגע ${targetUser} עומד על **${totalValidUses}** הזמנות חוקיות לשרת! 🚀`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: `Requested by ${interaction.user.tag}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'resetinvite') {
        if (!ADMIN_IDS.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ **Access Denied:** אין לך גישה להשתמש בפקודת האיפוס.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'all') {
            db.counts = {};
            saveDB();
            return interaction.reply({ content: '✅ **Successfully Done!** כל ההזמנות בשרת אופסו ל-0 בהצלחה!', ephemeral: true });
        } 
        
        if (subcommand === 'user') {
            const targetUser = interaction.options.getUser('target');
            db.counts[targetUser.id] = 0;
            saveDB();
            return interaction.reply({ content: `✅ **Successfully Done!** ההזמנות של ${targetUser} אופסו ל-0 בהצלחה!`, ephemeral: true });
        }
    }
});

client.login(TOKEN);