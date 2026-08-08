import {
    Badge,
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    HomePageSectionsProviding,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    PagedResults,
    PartialSourceManga,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga
} from "@paperback/types";

import * as cheerio from "cheerio";
import { TruyenQQMetadata } from "./model";

const BASE_URL = "https://truyenqqko.com";

export const TruyenqqInfo: SourceInfo = {
    version: "1.0",
    name: "Truyen QQ",
    description: `Extension that pulls content from ${BASE_URL}`,
    author: "Kizias",
    icon: "icon.png",
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: BASE_URL,
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
    sourceTags: [{ text: "Raw", type: BadgeColor.GREY } as Badge],
};

export class Truyenqq implements ChapterProviding, HomePageSectionsProviding, MangaProviding, SearchResultsProviding {
    requestManager = App.createRequestManager({
        requestsPerSecond: 5,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    "Referer": `${BASE_URL}/`,
                    "Origin": `${BASE_URL}/`,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    ...(request.headers ?? {})
                };
                return request;
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response;
            },
        },
    });

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const sections: HomeSection[] = [
            App.createHomeSection({
                id: "list_update_section",
                title: "Danh Sách Truyện Tranh Mới",
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: "list_top_section",
                title: "Top Tháng",
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true,
            }),
            App.createHomeSection({
                id: "list_suggest_section",
                title: "Truyện Yêu Thích",
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true,
            })
        ];

        for (const section of sections) {
            sectionCallback(section);
        }

        const listUpdateItems = await this.getMangaListUpdateItems('truyen-moi-cap-nhat', undefined);
        const listTopMonthItems = await this.getMangaListUpdateItems('top-thang', undefined);
        const listSuggestItems = await this.getMangaListUpdateItems('truyen-yeu-thich', undefined);

        for (const section of sections) {
            switch (section.id) {
                case "list_update_section":
                    section.items = listUpdateItems.results;
                    break;
                case "list_top_section":
                    section.items = listTopMonthItems.results;
                    break;
                case "list_suggest_section":
                    section.items = listSuggestItems.results;
                    break;
            }
            sectionCallback(section);
        }
    }
    async getViewMoreItems(sectionId: string, metadata: TruyenQQMetadata | undefined): Promise<PagedResults> {
        switch (sectionId) {
            case "list_update_section":
                return this.getMangaListUpdateItems('truyen-moi-cap-nhat', metadata);
            case "list_top_section":
                return this.getMangaListUpdateItems('top-thang', metadata);
            case "list_suggest_section":
                return this.getMangaListUpdateItems('truyen-yeu-thich', metadata);
            default:
                return App.createPagedResults({ results: [] });
        }
    }

    private async getMangaListUpdateItems(category: string, metadata: TruyenQQMetadata | undefined): Promise<PagedResults> {
        const page = metadata?.page ?? 1;
        const collectedIds = metadata?.collectedIds ?? [];

        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}/${category}/trang-${page}`,
            method: "GET"
        }), 1);

        const $ = cheerio.load(response.data as string);

        const items: PartialSourceManga[] = [];
        const seen = new Set<string>(collectedIds);

        $("div#main_homepage ul.list_grid.grid li").each((_, element) => {
            const el = $(element);

            const title = el.find(".book_info .book_name a").text().trim();
            const latestChapter = el.find(".last_chapter").first().text().trim();
            const image = el.find(".book_avatar a img").first().attr("src") || "";

            const mangaUrl = el.find(".book_name a").attr("href") || "";
            const mangaIdMatch = mangaUrl.match(/\/truyen-tranh\/([^/]+)\/?/);
            const mangaId = mangaIdMatch ? mangaIdMatch[1] : "";

            if (mangaId && !seen.has(mangaId)) {
                seen.add(mangaId);
                items.push(
                    App.createPartialSourceManga({
                        mangaId: mangaId,
                        title: title,
                        image: image,
                        subtitle: latestChapter || undefined,
                    })
                );
            }
        });

        const hasNextPage = $(`div .page_redirect a`).length > 0;

        return App.createPagedResults({
            results: items,
            metadata: hasNextPage
                ? { page: page + 1, collectedIds: Array.from(seen) }
                : undefined,
        });
    }

    async getSearchResults(query: SearchRequest, metadata: TruyenQQMetadata | undefined): Promise<PagedResults> {
        const collectedIds: string[] = metadata?.collectedIds ?? [];
        const page: number = metadata?.page ?? 1;
        const searchTerm = query.title ?? "";

        const response = await this.requestManager.schedule(
            App.createRequest({
                url: `${BASE_URL}/tim-kiem/trang-${page}?q=${encodeURIComponent(searchTerm)}`,
                method: "GET"
            }), 1
        );
        const $ = cheerio.load(response.data as string);

        const results: PartialSourceManga[] = [];
        const seenIds = new Set<string>(collectedIds);

        $("#main_homepage .list_grid li").each((_, element) => {
            const el = $(element);

            const title = el.find('.book_name').text().trim();
            const image = el.find(".book_avatar img").first().attr("src") || "";
            const mangaUrl = el.find(".book_name a").attr("href") || "";
            const mangaIdMatch = mangaUrl.match(/\/truyen-tranh\/([^/]+)\/?/);
            const mangaId = mangaIdMatch ? mangaIdMatch[1] : "";

            if (!mangaId || seenIds.has(mangaId)) return;
            seenIds.add(mangaId);

            collectedIds.push(mangaId);
            results.push(App.createPartialSourceManga({ mangaId, image, title }));
        });

        const hasNextPage = $(`div .page_redirect a`).length > 0;

        return App.createPagedResults({
            results,
            metadata: results.length > 0 && hasNextPage ? {
                page: page + 1, collectedIds
            } : undefined,
        });
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}/truyen-tranh/${mangaId}`,
            method: "GET"
        }), 1);
        const $ = cheerio.load(response.data as string);

        const title = $('h1[itemprop="name"]').first().text().trim();

        const image = $('.book_avatar img[itemprop="image"]').first().attr("src") || "";

        const description = $('div.story-detail-info').first().text().trim();
        const status = $('.book_info div.txt .status.row p').last().text().trim()
        const publisher = $('a.org').first().text().trim();

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [title],
                image: image,
                banner: image,
                author: publisher,
                desc: description,
                status: status,
                tags: []
            }),
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}/truyen-tranh/${mangaId}`,
            method: "GET"
        }), 1);
        const $ = cheerio.load(response.data as string);

        const chapters: Chapter[] = [];

        $(".works-chapter-list .works-chapter-item").each((_, element) => {
            const el = $(element);
            const aTag = el.find(".name-chap a").first();
            const href = aTag.attr("href") || "";
            if (!href) return;

            const chapterTitle = aTag.text().trim();
            const chapNumMatch = chapterTitle.match(/(?:chương|chap|ep)?\s*([\d.]+)/i);
            const chapNum = chapNumMatch && chapNumMatch[1] ? parseFloat(chapNumMatch[1]) : 0;
            const chapterId = href.replace(/\/$/, "").split("/").pop() ?? "";
            const dateStr = el.find(".time-chap").text().trim();

            let chapterDate = new Date();
            if (dateStr) {
                const [dayStr, monthStr, yearStr] = dateStr.split("/");
                if (dayStr && monthStr && yearStr) {
                    chapterDate = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10));
                }
            }

            chapters.push(
                App.createChapter({
                    id: chapterId,
                    name: chapterTitle,
                    chapNum: chapNum,
                    time: chapterDate
                })
            );
        });

        return chapters.sort((a, b) => a.chapNum - b.chapNum);
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}/truyen-tranh/${chapterId}`,
            method: "GET",
        }), 1
        );
        const $ = cheerio.load(response.data as string);

        const pages: string[] = [];

        $(".chapter_content img.lazy").each((_, element) => {
            const el = $(element);
            const rawUrl = el.attr("src") || el.attr("data-cdn") || el.attr("data-original") || "";
            if (!rawUrl) return;
            pages.push(rawUrl);
        });

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
        });
    }
}
