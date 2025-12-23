import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DocumentStorageService {
  private readonly storageBaseDir = path.join(process.cwd(), 'local-storage', 'kyc-documents');

  constructor() {
    if (!fs.existsSync(this.storageBaseDir)) {
      fs.mkdirSync(this.storageBaseDir, { recursive: true });
    }
  }

  async saveDocument(file: Express.Multer.File, walletAddress: string, documentId: string): Promise<string> {
    const userDir = path.join(this.storageBaseDir, walletAddress);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const fileExtension = path.extname(file.originalname);
    const fileName = `${documentId}${fileExtension}`;
    const filePath = path.join(userDir, fileName);

    await fs.promises.writeFile(filePath, file.buffer);
    
    // Return relative path or URI
    return `file://${path.join('kyc-documents', walletAddress, fileName)}`;
  }

  async deleteDocument(fileUrl: string): Promise<void> {
      // Basic implementation for local file
      if (fileUrl.startsWith('file://')) {
          const relativePath = fileUrl.replace('file://', '');
           // Careful with path traversal here in real app
          const fullPath = path.join(process.cwd(), 'local-storage', relativePath);
          if (fs.existsSync(fullPath)) {
              await fs.promises.unlink(fullPath);
          }
      }
  }

  getFullPath(fileUrl: string): string {
       if (fileUrl.startsWith('file://')) {
          const relativePath = fileUrl.replace('file://', '');
          return path.join(process.cwd(), 'local-storage', relativePath);
      }
      throw new Error('Invalid file scheme');
  }
}
