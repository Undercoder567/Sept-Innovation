import crypto from 'crypto';

interface MaskingConfig {
  patterns: Record<string, RegExp>;
  replacements: Record<string, string>;
}

/**
 * PII Masking Service
 * Implements pattern-based masking for sensitive data before storage/transmission
 * Supports deterministic masking for consistency across requests
 */
class PIIMasker {
  private config: MaskingConfig;
  private encryptionKey: string;

  constructor(encryptionKey?: string) {
    this.encryptionKey = encryptionKey || process.env.ENCRYPTION_KEY || 'default-key';
    
    this.config = {
      patterns: {
        // Email: user@example.com -> u***@example.com
        email: /([a-zA-Z0-9._%+-]{1})([a-zA-Z0-9._%+-]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
        
        // Phone: +1(555)123-4567 -> +1(****)123-****
        phone: /(\+?\d{1,3}|\(?\d{3}\)?)[- .\s]*(\d{1,4})[- .\s]*(\d{1,4})/g,
        
        // Credit card: 1234 5678 9012 3456 -> **** **** **** 3456
        creditCard: /\b(\d{4})[- ]?(\d{4})[- ]?(\d{4})[- ]?(\d{4})\b/g,
        
        // SSN: 123-45-6789 -> ***-**-6789
        ssn: /\b(\d{3})-?(\d{2})-?(\d{4})\b/g,
        
        // Generic PII: person_id, customer_id patterns
        id: /\b(customer|person|user|employee|account)_?id[:\s=]*([a-zA-Z0-9]{8,})\b/gi,
        
        // Names (basic pattern - capture first letter + mask rest)
        personName: /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g,
      },
      replacements: {
        email: '$1***@$2',
        phone: '+1(****)***-****',
        creditCard: '**** **** **** ',
        ssn: '***-**-',
        id: '$1_id: ****',
        personName: '$1 $2', // Will be custom masked
      },
    };
  }

  /**
   * Mask PII in a string based on pattern matching
   */
  maskString(input: string): string {
    if (!input || typeof input !== 'string') {
      return input;
    }

    let masked = input;

    // Email masking
    masked = masked.replace(this.config.patterns.email, (match, p1, p2) => {
      return p1 + '***@' + p2.split('@')[1];
    });

    // Phone masking
    masked = masked.replace(this.config.patterns.phone, '+1(****)***-****');

    // Credit card masking
    masked = masked.replace(this.config.patterns.creditCard, '**** **** **** ');

    // SSN masking
    masked = masked.replace(this.config.patterns.ssn, '***-**-');

    // Generic ID masking
    masked = masked.replace(this.config.patterns.id, '$1_id: ****');

    // Person name masking (first letter + ***)
    masked = masked.replace(this.config.patterns.personName, (match, first, last) => {
      return first.charAt(0) + '*** ' + last.charAt(0) + '***';
    });

    return masked;
  }

  /**
   * Deterministic hashing for consistent PII replacement
   * Useful for joining data without exposing actual values
   */
  hashPII(value: string, context: string = 'default'): string {
    const hash = crypto
      .createHmac('sha256', this.encryptionKey + context)
      .update(value)
      .digest('hex')
      .substring(0, 16)
      .toUpperCase();
    
    return `[HASH_${hash}]`;
  }

  /**
   * Mask entire objects recursively
   */
  maskObject<T extends Record<string, any>>(
    obj: T,
    sensitiveFields: string[] = []
  ): T {
    const masked = { ...obj };

    // Common sensitive field patterns
    const defaultSensitivePatterns = [
      'password',
      'token',
      'secret',
      'apikey',
      'api_key',
      'ssn',
      'creditcard',
      'credit_card',
      'phone',
      'email',
      'personid',
      'person_id',
      'customerid',
      'customer_id',
      'accountid',
      'account_id',
      'dob',
      'dateofbirth',
      'date_of_birth',
    ];

    const patternsToCheck = [
      ...defaultSensitivePatterns,
      ...sensitiveFields.map(f => f.toLowerCase()),
    ];

    const maskedCopy = { ...masked };
    Object.keys(maskedCopy).forEach(key => {
      const lowerKey = key.toLowerCase();
      const isSensitive = patternsToCheck.some(pattern => lowerKey.includes(pattern));

      if (isSensitive) {
        const value = maskedCopy[key];
        
        if (typeof value === 'string') {
          (maskedCopy as any)[key] = this.maskString(value);
        } else if (typeof value === 'number') {
          (maskedCopy as any)[key] = this.hashPII(value.toString(), key) as any;
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          (maskedCopy as any)[key] = this.maskObject(value, sensitiveFields);
        } else if (Array.isArray(value)) {
          (maskedCopy as any)[key] = value.map(item =>
            typeof item === 'object' && item !== null
              ? this.maskObject(item, sensitiveFields)
              : item
          );
        }
      }
    });
    return maskedCopy as T;
    return masked;
  }

  /**
   * Check if a string contains PII patterns
   */
  containsPII(input: string): boolean {
    if (!input || typeof input !== 'string') {
      return false;
    }

    return Object.values(this.config.patterns).some(pattern => pattern.test(input));
  }

  /**
   * Get PII patterns found in a string
   */
  getPIIPatterns(input: string): string[] {
    if (!input || typeof input !== 'string') {
      return [];
    }

    const found: string[] = [];
    const patternNames = Object.keys(this.config.patterns);

    patternNames.forEach(name => {
      const pattern = this.config.patterns[name];
      if (pattern.test(input)) {
        found.push(name);
      }
    });

    return found;
  }

  /**
   * Create a tokenized version that preserves structure but masks values
   */
  tokenizePII(input: string, token: string = 'PII'): string {
    if (!input || typeof input !== 'string') {
      return input;
    }

    let tokenized = input;
    Object.keys(this.config.patterns).forEach(key => {
      tokenized = tokenized.replace(
        this.config.patterns[key],
        `[${token.toUpperCase()}_${key.toUpperCase()}]`
      );
    });

    return tokenized;
  }
}

export { PIIMasker };
export default new PIIMasker();
