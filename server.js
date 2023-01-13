import fastify from "fastify"
import sensible from "@fastify/sensible"
import cors from "@fastify/cors"
import cookie from "@fastify/cookie"
import dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"

// allows loading from .env file
dotenv.config

const app = fastify()
app.register(sensible)
app.register(cookie, { secret: process.env.COOKIE_SECRET })
app.register(cors, {
    origin: process.env.CLIENT_URL,
    credentials: true,
})

// allows for "faked" log in, sends current userId down in cookie
// everytime req is made, set cookie in browser to userId of CURRENT_USER_ID
app.addHook("onRequest", (req, res, done) => {
    if (req.cookies.userId !== CURRENT_USER_ID) {
        req.cookies.userId = CURRENT_USER_ID
        res.clearCookie("userId")
        res.setCookie("userId", CURRENT_USER_ID)
    }
    done()
})
const prisma = new PrismaClient()

// get user with name, get id, sets to current user
// fake log in as "Kyle", or "Sally"
const CURRENT_USER_ID = (
    await prisma.user.findFirst({
        where: {
            name: "Kyle"
        }
    })
).id
const COMMENT_SELECT_FIELDS = {
    id: true,
    message: true,
    parentId: true,
    createdAt: true,
    user: {
        select: {
            id: true,
            name: true,
        }
    }
}


// get route that returns all posts
app.get("/posts", async (req, res) => {
    return await commitToDb(
        prisma.post.findMany({
            select: {
                id: true,
                title: true,
            },
        })
    )
})

app.get("/posts/:id", async (req, res) => {
    return await commitToDb(
        prisma.post.findUnique({
            where: { id: req.params.id },
            select: {
                body: true,
                title: true,
                comments: {
                    orderBy: {
                        createdAt: "desc",
                    },
                    select: {
                        ...COMMENT_SELECT_FIELDS,
                        _count: { select: { likes: true } },
                    },
                },
            },
        }).then(async post => {
            const likes = await prisma.like.findMany({
                where: {
                    userId: req.cookies.userId,
                    commentId: { in: post.comments.map(comment => comment.id) }
                },
            })

            return {
                ...post,
                comments: post.comments.map(comment => {
                    const { _count, ...commentFields } = comment
                   // console.log(_count.likes)
                    return {
                        ...commentFields,
                        likedByMe: likes.find(like => like.commentId === comment.id),
                        likeCount: _count.likes,
                    }
                }),
            }
        })
    )
})

app.post("/posts/:id/comments", async (req, res) => {
    if (req.body.message === "" || req.body.message == null) {
        return res.send(app.httpErrors.badRequest("Message is required")
        )
    }

    return await commitToDb(
        prisma.comment.create({
            data: {
                message: req.body.message,
                userId: req.cookies.userId,
                parentId: req.body.parentId,
                postId: req.params.id
            },
            select: COMMENT_SELECT_FIELDS,
        }).then(comment => {
            return {
                ...comment,
                likeCount: 0,
                likedByMe: false
            }
        })
    )
})

app.put("/posts/:postId/comments/:commentId", async (req, res) => {
    if (req.body.message === "" || req.body.message == null) {
        return res.send(app.httpErrors.badRequest("Message is required"))
    }
    // check to make sure user has permission to edit
    // gets userId for current comment
    const { userId } = await prisma.comment.findUnique({
        where: { id: req.params.commentId },
        select: { userId: true },
    })
    if (userId !== req.cookies.userId) {
        return res.send(app.httpErrors.unauthorized("You do not have permission to edit this message"))
    }

    return await commitToDb(
        prisma.comment.update({
            where: { id: req.params.commentId },
            data: { message: req.body.message },
            select: { message: true },
        })
    )
})

app.delete("/posts/:postId/comments/:commentId", async (req, res) => {
    // check to make sure user has permission to edit
    // gets userId for current comment
    const { userId } = await prisma.comment.findUnique({
        where: { id: req.params.commentId },
        select: { userId: true },
    })
    if (userId !== req.cookies.userId) {
        return res.send(app.httpErrors.unauthorized("You do not have permission to delete this message"))
    }

    return await commitToDb(
        prisma.comment.delete({
            where: { id: req.params.commentId },
            select: { id: true },
        }))
})

app.post("/posts/:postId/comments/:commentId/toggleLike", async (req, res) => {
    const data = {
        commentId: req.params.commentId,
        userId: req.cookies.userId,
    }

    const like = await prisma.like.findUnique({
        where: { userId_commentId: data },
    })

    if (like == null) {
        return await commitToDb(prisma.like.create({ data })).then(() => {
            return { addLike: true }
        })
    } else {
        return await commitToDb(prisma.like.delete({
            where: { userId_commentId: data }
        }))
            .then(() => {
                return { addLike: false }
            })
    }
})

// takes in async function, returns error/result
async function commitToDb(promise) {
    const [error, data] = await app.to(promise)
    if (error) return app.httpErrors.internalServerError(error.message)
    return data
}

// env variable port, see .env file
app.listen({ port: process.env.PORT })
