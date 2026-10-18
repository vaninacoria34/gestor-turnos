const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const isProduction = process.env.NODE_ENV === 'production';
const configuredSecret = process.env.JWT_SECRET;

if (isProduction && (!configuredSecret || Buffer.byteLength(configuredSecret, 'utf8') < 32)) {
  throw new Error('En producción, JWT_SECRET debe configurarse con al menos 32 bytes aleatorios.');
}

const JWT_SECRET = configuredSecret || 'gestor-turnos-dev-secret';

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role || 'admin',
    },
    JWT_SECRET,
    { expiresIn: '8h' },
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;

  if (!token) {
    return res.status(401).json({ message: 'Token requerido.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido o expirado.' });
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  signToken,
  authMiddleware,
};
