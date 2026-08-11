import {
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
import { SayHentaiMetadata } from "./model";

const BASE_URL = "https://sayhentai.cx";

export const SayhentaiInfo: SourceInfo = {
    version: "1.0",
    name: "Say Hentai",
    description: `Extension that pulls content from ${BASE_URL}`,
    author: "Kizias",
    icon: "icon.png",
    contentRating: ContentRating.ADULT,
    websiteBaseURL: BASE_URL,
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
    sourceTags: [
        {
            text: '18+',
            type: BadgeColor.YELLOW
        }
    ]
};

export class Sayhentai implements ChapterProviding, HomePageSectionsProviding, MangaProviding, SearchResultsProviding {
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
                id: "list_manhwa_section",
                title: "Manhwa",
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true,
            }),
            App.createHomeSection({
                id: "list_completed_section",
                title: "Truyện Hoàn Thành",
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true,
            })
        ];

        for (const section of sections) {
            sectionCallback(section);
        }

        const listUpdateItems = await this.getMangaListUpdateItems('', undefined);
        const listManhwaItems = await this.getMangaListUpdateItems('/genre/manhwa', undefined);
        const listCompletedItems = await this.getMangaListUpdateItems('/completed', undefined);

        for (const section of sections) {
            switch (section.id) {
                case "list_update_section":
                    section.items = listUpdateItems.results;
                    break;
                case "list_manhwa_section":
                    section.items = listManhwaItems.results;
                    break;
                case "list_completed_section":
                    section.items = listCompletedItems.results;
                    break;
            }
            sectionCallback(section);
        }
    }

    async getViewMoreItems(sectionId: string, metadata: SayHentaiMetadata | undefined): Promise<PagedResults> {
        switch (sectionId) {
            case "list_update_section":
                return this.getMangaListUpdateItems('', metadata);
            case "list_manhwa_section":
                return this.getMangaListUpdateItems('/genre/manhwa', metadata);
            case "list_completed_section":
                return this.getMangaListUpdateItems('/completed', metadata);
            default:
                return App.createPagedResults({ results: [] });
        }
    }

    private async getMangaListUpdateItems(category: string, metadata: SayHentaiMetadata | undefined): Promise<PagedResults> {
        const page = metadata?.page ?? 1;
        const collectedIds = metadata?.collectedIds ?? [];

        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}${category}?page=${page}`,
            method: "GET"
        }), 1);

        const $ = cheerio.load(response.data as string);

        const items: PartialSourceManga[] = [];
        const seen = new Set<string>(collectedIds);

        $('.page-item-detail').each((_, element) => {
            const el = $(element);

            const title = el.find(".post-title h3 a").text().trim();
            const latestChapter = el.find(".chapter-item .chapter a").first().text().trim();
            const image = el.find("img.img-responsive").attr("data-src") || el.find("img.img-responsive").attr("src") || ""

            const mangaUrl: string = el.find(".post-title h3 a").attr("href") || "";
            const mangaId: string = mangaUrl ? mangaUrl.split('/').filter(Boolean).pop()?.replace(/\.html$/, '') || "" : "";

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

        const hasNextPage = $(".pager").find('li.active + li').length > 0;

        return App.createPagedResults({
            results: items,
            metadata: hasNextPage
                ? { page: page + 1, collectedIds: Array.from(seen) }
                : undefined,
        });
    }

    async getSearchResults(query: SearchRequest, metadata: SayHentaiMetadata | undefined): Promise<PagedResults> {
        const collectedIds: string[] = metadata?.collectedIds ?? [];
        const page: number = metadata?.page ?? 1;
        const searchTerm = query.title ?? "";

        const response = await this.requestManager.schedule(
            App.createRequest({
                url: `${BASE_URL}/search?q=${encodeURIComponent(searchTerm)}&page=${page}`,
                method: "GET"
            }), 1
        );
        const $ = cheerio.load(response.data as string);

        const results: PartialSourceManga[] = [];
        const seenIds = new Set<string>(collectedIds);

        $('.page-item-detail').each((_, element) => {
            const el = $(element);

            const title = el.find(".post-title h3 a").text().trim();

            const image = el.find("img.img-responsive").attr("data-src") || el.find("img.img-responsive").attr("src") || ""

            const mangaUrl: string = el.find(".post-title h3 a").attr("href") || "";
            const mangaId: string = mangaUrl ? mangaUrl.split('/').filter(Boolean).pop()?.replace(/\.html$/, '') || "" : "";

            if (!mangaId || seenIds.has(mangaId)) return;
            seenIds.add(mangaId);

            collectedIds.push(mangaId);
            results.push(App.createPartialSourceManga({ mangaId, image, title }));
        });

        const hasNextPage = $(".pager").find('li.active + li').length > 0;

        return App.createPagedResults({
            results,
            metadata: results.length > 0 && hasNextPage ? {
                page: page + 1, collectedIds
            } : undefined,
        });
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}/${mangaId}.html`,
            method: "GET"
        }), 1);
        const $ = cheerio.load(response.data as string);

        const title = $('.post-title h1').first().text().trim();
        const rawImage = $(".summary_image img").first().attr("src")?.trim() || "";
        const image = rawImage ? encodeURI(rawImage) : "";
        const description = $('.original-content').first().text().trim();

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [title],
                image: image,
                author: 'N/A',
                artist: 'N/A',
                desc: description,
                status: 'N/A',
                tags: []
            }),
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const responseChaptersDetail = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}/${mangaId}.html`,
            method: "GET"
        }), 1);
        const $chaptersDetail = cheerio.load(responseChaptersDetail.data as string);

        const firstHref = $chaptersDetail('ul.box-list-chapter li a[href]').first().attr('href') || "";
        if (!firstHref) return [];

        const firstChapterId = firstHref.replace(/\/$/, "").split("/").pop() ?? "";
        if (!firstChapterId) return [];

        const cleanMangaId = mangaId.replace(/\.html$/, "");
        const responseChaptersList = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}/${cleanMangaId}/${firstChapterId}`,
            method: "GET",
        }), 1);

        const chapters: Chapter[] = [];
        const $chaptersList = cheerio.load(responseChaptersList.data as string);
        $chaptersList('#manga-reading-nav-foot div .selectpicker_chapter select option').each((_, element) => {
            const el = $chaptersList(element);
            const dataRedirect = el.attr("data-redirect") || "";
            if (!dataRedirect) return;

            const chapterTitle = el.text().trim();
            const optionValue = String(el.val() || el.attr("value") || "");
            const chapNumMatch = optionValue.match(/\d+(?:\.\d+)?/);
            const chapNum = chapNumMatch ? parseFloat(chapNumMatch[0]) : 0;

            const chapterId = dataRedirect.replace(/\/$/, "").split("/").pop() ?? "";

            chapters.push(
                App.createChapter({
                    id: chapterId,
                    name: chapterTitle,
                    chapNum: chapNum
                })
            );
        });

        return chapters;
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const cleanMangaId = mangaId.replace(/\.html$/, "");
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${BASE_URL}/${cleanMangaId}/${chapterId}`,
            method: "GET",
        }), 1);

        const $ = cheerio.load(response.data as string);
        const pages: string[] = [];

        $("#chapter_content img").each((_, element) => {
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
