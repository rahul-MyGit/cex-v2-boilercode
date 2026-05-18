import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { authSchema } from '../types/auth-schema.js';
import { createToken } from '../utils/auth.js';
import { sendValidationError } from '../utils/validation.js';

export async function signup(req: Request, res: Response): Promise<void> {
  const parsedBody = authSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }

  const { username, password } = parsedBody.data;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
      },
    });

    res.status(201).json({
      token: createToken({ userId: user.id }),
      userId: user.id,
      username: user.username,
    });
  } catch (error) {
    console.log(error);
    res.status(409).json({ error: 'username already exists' });
  }
}

export async function signin(req: Request, res: Response): Promise<void> {
  const parsedBody = authSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }

  const { username, password } = parsedBody.data;

  try {
    const user = await prisma.user.findFirst({
      where: {
        username,
      },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'user not found',
      });

      return;
    }

    const matchPassword = await bcrypt.compare(password, user.password);

    if (!matchPassword) {
      res.status(401).json({
        success: false,
        message: 'Incorrect password',
      });

      return;
    }

    const payload = {
      userId: user.id,
      username: user.username,
    };

    const token = createToken(payload);

    res.status(200).json({
      success: true,
      message: 'User logged in successfully',
      userId: user.id,
      username: user.username,
      token,
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'user validation error',
    });
  }
}
